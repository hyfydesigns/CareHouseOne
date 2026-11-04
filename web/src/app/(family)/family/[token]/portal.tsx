"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { FormLetterhead } from "@/components/form-letterhead";
import { OnboardingFormView } from "@/components/onboarding-form";
import { SignDialog } from "@/components/sign-dialog";
import { Status, type FormState } from "@/components/status";
import { changedSignatures, mergeAnswers, type Block, type Values } from "@/lib/onboarding-forms";
import type { familyView } from "@/server/onboarding";
import { removeFileAction, saveAction, signAction, submitAction } from "./actions";

type View = Awaited<ReturnType<typeof familyView>>;
type Item = View["items"][number];

const STATUS: Record<Item["status"], [string, string]> = {
  todo: ["To do", ""],
  changes: ["Changes requested", "warn"],
  submitted: ["Sent to the home", "info"],
  approved: ["Approved", "ok"],
};

export function CodeGate({ sendCode, verify }: { sendCode: () => Promise<FormState>; verify: (s: FormState, fd: FormData) => Promise<FormState> }) {
  const [sent, setSent] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, action, pending] = useActionState(verify, {});
  return (
    <div className="stack">
      <button
        type="button"
        className={`btn ${sent?.message ? "" : "primary"} big`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setSent(await sendCode());
          setBusy(false);
        }}
      >
        {sent?.message ? "Send another code" : "Email me a code"}
      </button>
      {sent && <Status state={sent} />}
      {sent?.message && (
        <form action={action} className="stack">
          <div className="field">
            <label htmlFor="code">6-digit code</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required style={{ fontSize: 22, letterSpacing: 4, maxWidth: 200 }} />
          </div>
          <Status state={state} />
          <button className="btn primary big" disabled={pending}>Continue</button>
        </form>
      )}
    </div>
  );
}

/** The family's checklist, and one item at a time to fill in, sign, upload and send. */
export function FamilyPortal({ token, view, openItem, consentText }: { token: string; view: View; openItem: string | null; consentText: string }) {
  const { packet } = view;
  const item = view.items.find((i) => i.id === openItem);
  const required = view.items.filter((i) => i.required);
  const sent = required.filter((i) => i.status === "submitted" || i.status === "approved").length;

  if (packet.status === "admitted") {
    return (
      <div className="card">
        <FormLetterhead head={view.head} />
        <h1>{packet.residentFirstName}&apos;s paperwork is complete</h1>
        <p>{view.org} ({view.home}) has admitted {packet.residentFirstName}. Here are your signed copies. Download them now: this page stops working after the date in the email.</p>
        <ul className="checklist" style={{ listStyle: "none", padding: 0 }}>
          {view.documents.map((d) => (
            <li key={d.id}>
              <a className="checklist-item" href={`/api/family/${token}/documents/${d.id}?download=1`}>
                <span className="grow"><b>{d.title}</b><br /><span className="small muted">{d.contentType === "application/pdf" ? "PDF" : "Photo"} · {(d.sizeBytes / 1024 / 1024).toFixed(1)} MB</span></span>
                <span className="btn small">Download</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (item) return <ItemPage key={item.id} head={view.head} token={token} item={item} poaName={packet.poaName} consentText={consentText} locked={packet.status !== "open"} />;

  return (
    <>
      <div className="card">
        <FormLetterhead head={view.head} />
        <h1>Move-in paperwork for {packet.residentFirstName} {packet.residentLastName}</h1>
        <p className="small muted" style={{ margin: 0 }}>
          Open each item, fill it in and sign, or upload the documents asked for, then send it to the home. Your answers are saved as you go, so you can stop and come back with the same link.
        </p>
        <div className="stat-row">
          <span className={`stat ${sent === required.length ? "good" : "info"}`}><b>{sent}/{required.length}</b><span>required items sent</span></span>
        </div>
      </div>
      <ul className="checklist" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {view.items.map((i) => (
          <li key={i.id}>
            <Link className="checklist-item" href={`/family/${token}?item=${i.id}`}>
              <span className="grow">
                <b>{i.title}</b>{!i.required && <span className="small muted"> (optional)</span>}
                <br />
                <span className="small muted">{i.description || (i.kind === "upload" ? "Upload a photo or PDF" : "Fill in and sign")}</span>
              </span>
              <span className={`pill ${STATUS[i.status][1]}`}>{STATUS[i.status][0]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Answers save on their own this long after the last change. */
const AUTOSAVE_MS = 1000;

function ItemPage({ head, token, item, poaName, consentText, locked }: { head: View["head"]; token: string; item: Item; poaName: string; consentText: string; locked: boolean }) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(item.values);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<Extract<Block, { type: "signature" }> | null>(null);
  const readOnly = locked || item.status === "approved";
  const [signAgain, setSignAgain] = useState<Set<string>>(new Set());
  const latest = useRef(values);
  const saved = useRef(values);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // A signature comes off as soon as an answer on its part changes, before the save reaches the server.
  const outdated = (v: Values) => changedSignatures(item.title, item.blocks, item.values, mergeAnswers(item.blocks, item.values, v, "poa"), Object.keys(item.signatures));
  const stale = new Set(outdated(values));
  const signatures = Object.fromEntries(Object.entries(item.signatures).filter(([k]) => !stale.has(k)).map(([k, s]) => [k, { name: s.name, image: s.image, signedAt: new Date(s.signedAt).toLocaleString() }]));

  async function save(quiet = false): Promise<boolean> {
    clearTimeout(timer.current);
    const sending = latest.current;
    if (sending === saved.current) return true;
    const r = await saveAction(token, item.id, sending);
    if (r.error || !quiet) setState(r);
    if (r.error) return false;
    saved.current = sending;
    setDirty(latest.current !== sending);
    return true;
  }

  // Leaving within a moment of typing still keeps the answer.
  useEffect(() => () => {
    clearTimeout(timer.current);
    if (latest.current !== saved.current) void saveAction(token, item.id, latest.current);
  }, [token, item.id]);

  async function send() {
    setBusy(true);
    if (await save()) {
      const r = await submitAction(token, item.id);
      setState(r);
      if (!r.error) router.push(`/family/${token}`);
    }
    setBusy(false);
  }
  async function upload(list: FileList | null) {
    if (!list?.length) return;
    setBusy(true);
    for (const f of [...list]) {
      const body = new FormData();
      body.append("file", f, f.name || "photo.jpg");
      const res = await fetch(`/api/family/${token}/items/${item.id}/files`, { method: "POST", body }).catch(() => null);
      const json = (await res?.json().catch(() => null)) as { message?: string; error?: string } | null;
      setState(res?.ok ? { message: json?.message } : { error: json?.error ?? "Couldn't upload. Check the connection and try again." });
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <div className="card">
      <Link href={`/family/${token}`} className="small">‹ Back to the checklist</Link>
      <FormLetterhead head={head} />
      <h1>{item.title}</h1>
      {item.description && <p style={{ margin: 0 }}>{item.description}</p>}
      {item.status === "changes" && item.staffNote && <p className="banner offline" role="alert"><b>The home asked for changes:</b>&nbsp;{item.staffNote}</p>}
      {item.status === "approved" && <p className="notice">The home approved this. If something needs correcting, contact the home.</p>}

      {item.kind === "form" ? (
        <OnboardingFormView
          blocks={item.blocks}
          values={values}
          who="poa"
          onChange={readOnly ? undefined : (id, v) => {
            const next = { ...latest.current, [id]: v };
            latest.current = next;
            setValues(next);
            setDirty(true);
            setSignAgain((x) => new Set([...x, ...outdated(next)]));
            clearTimeout(timer.current);
            timer.current = setTimeout(() => void save(true), AUTOSAVE_MS);
          }}
          signatures={signatures}
          signAgain={signAgain}
          onSign={readOnly ? undefined : async (b) => ((await save()) ? setSigning(b) : undefined)}
          disabled={busy}
        />
      ) : (
        <div className="stack">
          {item.files.length > 0 && (
            <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
              {item.files.map((f) => (
                <li key={f.id} className="attach-chip">
                  <span className="attach-pdf" aria-hidden="true">{f.contentType === "application/pdf" ? "PDF" : "IMG"}</span>
                  <a className="grow" href={`/api/family/${token}/files/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>
                  {!readOnly && (
                    <button type="button" className="btn small" disabled={busy} onClick={async () => { setState(await removeFileAction(token, f.id)); router.refresh(); }}>Remove</button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {!readOnly && (
            <div className="row">
              <label className="btn">Take a photo<input type="file" accept="image/*" capture="environment" hidden onChange={(e) => upload(e.target.files)} /></label>
              <label className="btn">Choose files<input type="file" accept="image/*,application/pdf" multiple hidden onChange={(e) => upload(e.target.files)} /></label>
            </div>
          )}
          <p className="small muted" style={{ margin: 0 }}>Photos or PDFs, up to 9 MB each. For a card, upload the front and the back.</p>
        </div>
      )}

      <Status state={state} />
      {!readOnly && (
        <div className="row">
          {item.kind === "form" && <button type="button" className="btn" disabled={busy || !dirty} onClick={async () => { setBusy(true); await save(); setBusy(false); router.refresh(); }}>Save for later</button>}
          <button type="button" className="btn primary big" disabled={busy} onClick={send}>Send to the home</button>
        </div>
      )}
      {signing && (
        <SignDialog
          label={signing.label}
          defaultName={poaName}
          consentText={consentText}
          onClose={() => setSigning(null)}
          onSign={async (s) => {
            const r = await signAction(token, item.id, signing.id, s);
            if (r.error) return r.error;
            setState(r);
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}
