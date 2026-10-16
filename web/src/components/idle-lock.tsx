"use client";

import { useEffect, useRef, useState } from "react";

const EVENTS = ["pointerdown", "keydown", "touchstart", "wheel", "scroll"] as const;

/**
 * Shared tablets only. After `minutes` without a touch the screen is covered at once (even
 * offline), then the server session is locked and the browser moves to the lock screen.
 * A full page load (not router.push) so nothing from the page stays in memory or in Back history.
 * While someone is using the tablet it tells the server, so the server-side lock doesn't fire mid-form.
 */
export function IdleLock({ minutes, lock }: { minutes: number; lock: () => Promise<void> }) {
  const last = useRef(0);
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    last.current = Date.now();
    let reported = Date.now();
    let locking = false;
    const touch = () => {
      last.current = Date.now();
    };
    EVENTS.forEach((e) => window.addEventListener(e, touch, { passive: true }));
    const tick = setInterval(() => {
      const idle = Date.now() - last.current;
      if (idle >= minutes * 60_000) {
        setCovered(true);
        // Offline, the cover stays up and this retries each tick until the connection is back.
        if (!locking && navigator.onLine) {
          locking = true;
          lock().then(
            () => window.location.replace("/locked"),
            () => {
              locking = false;
            },
          );
        }
        return;
      }
      if (navigator.onLine && last.current > reported && Date.now() - reported > 60_000) {
        reported = Date.now();
        fetch("/api/heartbeat", { method: "POST", cache: "no-store" })
          .then((r) => r.json())
          .then((s: { signedIn: boolean; locked: boolean }) => {
            if (!s.signedIn || s.locked) window.location.replace("/locked");
          })
          .catch(() => {});
      }
    }, 5_000);
    return () => {
      clearInterval(tick);
      EVENTS.forEach((e) => window.removeEventListener(e, touch));
    };
  }, [minutes, lock]);

  if (!covered) return null;
  return (
    <div className="lock-cover" role="alertdialog" aria-label="Tablet locked">
      <div className="card">
        <h1>Tablet locked</h1>
        <p className="muted">{navigator.onLine ? "Opening the lock screen…" : "Reconnect to the internet, then unlock with your PIN."}</p>
        <button className="btn primary" onClick={() => window.location.replace("/locked")}>
          Unlock
        </button>
      </div>
    </div>
  );
}
