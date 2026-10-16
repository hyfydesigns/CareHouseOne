"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { discard, enqueue, flush, summary, type QueueKind, type QueueSummary } from "@/lib/offline-queue";

const OfflineContext = createContext<{ userId: string } | null>(null);

function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
}

const KIND_LABEL: Record<QueueKind, string> = { vitals: "Vital signs", note: "Progress note" };
const EMPTY: QueueSummary = { mine: 0, others: 0, problems: [] };

/** Wraps signed-in pages: registers the service worker, shows the offline banner, and sends saved entries. */
export function OfflineProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const online = useOnline();
  const [queue, setQueue] = useState<QueueSummary>(EMPTY);
  const [sent, setSent] = useState<string | null>(null);
  const router = useRouter();

  const refresh = useCallback(() => {
    summary(userId).then(setQueue, () => setQueue(EMPTY));
  }, [userId]);

  const send = useCallback(async () => {
    const n = await flush(userId).catch(() => null);
    if (n) {
      setSent(`${n} saved ${n === 1 ? "entry was" : "entries were"} sent.`);
      router.refresh();
    }
    refresh();
  }, [userId, refresh, router]);

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    window.addEventListener("ch1-queue", refresh);
    const first = setTimeout(refresh, 0);
    return () => {
      clearTimeout(first);
      window.removeEventListener("ch1-queue", refresh);
    };
  }, [refresh]);

  // When the connection comes back (and every 30 seconds while anything is waiting), send.
  useEffect(() => {
    if (!online || !queue.mine) return;
    const first = setTimeout(send, 0);
    const t = setInterval(send, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [online, queue.mine, send]);

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <OfflineContext.Provider value={{ userId }}>
      {!online && (
        <div className="banner offline" role="status">
          <b>You&apos;re offline.</b> Vital signs and progress notes are saved on this tablet and sent when the connection is back. Medications can&apos;t be
          recorded offline: follow the home&apos;s downtime procedure.
        </div>
      )}
      {queue.mine > 0 && (
        <div className="banner" role="status">
          {queue.mine} {queue.mine === 1 ? "entry is" : "entries are"} saved on this tablet, waiting to send.
          {online && (
            <button className="btn small" onClick={send} style={{ marginLeft: 10 }}>
              Send now
            </button>
          )}
        </div>
      )}
      {queue.others > 0 && <div className="banner small">{queue.others} saved {queue.others === 1 ? "entry belongs" : "entries belong"} to someone else. They&apos;ll send when that person signs in here.</div>}
      {queue.problems.map((p) => (
        <div className="banner error" role="alert" key={p.clientId}>
          {KIND_LABEL[p.kind]} from {new Date(p.createdAt).toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} couldn&apos;t be saved: {p.error}
          <button className="btn small" style={{ marginLeft: 10 }} onClick={() => discard(p.clientId)}>
            I&apos;ve dealt with it, remove
          </button>
        </div>
      ))}
      {sent && online && !queue.mine && (
        <div className="banner ok" role="status">
          {sent}
          <button className="linkbtn" style={{ marginLeft: 10 }} onClick={() => setSent(null)}>
            Dismiss
          </button>
        </div>
      )}
      {children}
    </OfflineContext.Provider>
  );
}

/**
 * For the vital-signs and progress-note forms: online, the form submits normally. Offline, it
 * saves the entry to the encrypted queue instead and clears the form.
 */
export function useOfflineSubmit(kind: QueueKind) {
  const ctx = useContext(OfflineContext);
  const [saved, setSaved] = useState<string | null>(null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    setSaved(null);
    if (!ctx || navigator.onLine) return;
    e.preventDefault();
    const form = e.currentTarget;
    const payload: Record<string, string> = {};
    new FormData(form).forEach((v, k) => {
      if (typeof v === "string") payload[k] = v;
    });
    enqueue(ctx.userId, kind, payload).then(
      () => {
        form.reset();
        setSaved("Saved on this tablet. It will be sent when the connection is back.");
      },
      () => setSaved("Couldn't save on this tablet. Write it on paper and enter it when you're back online."),
    );
  };
  return { onSubmit, saved };
}
