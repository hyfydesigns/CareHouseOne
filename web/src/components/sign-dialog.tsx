"use client";

import { useEffect, useRef, useState } from "react";

export interface SignInput {
  name: string;
  method: "drawn" | "typed";
  image?: string;
  consent: boolean;
}

/**
 * Sign one line: draw with a finger or mouse, or type the name. Either way the signer agrees to
 * sign electronically first (the consent text is recorded with the signature).
 */
export function SignDialog({ label, defaultName, consentText, onSign, onClose }: { label: string; defaultName: string; consentText: string; onSign: (s: SignInput) => Promise<string | null>; onClose: () => void }) {
  const [method, setMethod] = useState<"drawn" | "typed">("drawn");
  const [name, setName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drawn, setDrawn] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c || method !== "drawn") return;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio;
    c.height = c.clientHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.5;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#111";
    let down = false;
    const at = (e: PointerEvent) => {
      const r = c.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const start = (e: PointerEvent) => {
      down = true;
      c.setPointerCapture(e.pointerId);
      const [x, y] = at(e);
      g.beginPath();
      g.moveTo(x, y);
    };
    const move = (e: PointerEvent) => {
      if (!down) return;
      const [x, y] = at(e);
      g.lineTo(x, y);
      g.stroke();
      setDrawn(true);
    };
    const end = () => (down = false);
    c.addEventListener("pointerdown", start);
    c.addEventListener("pointermove", move);
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);
    return () => {
      c.removeEventListener("pointerdown", start);
      c.removeEventListener("pointermove", move);
      c.removeEventListener("pointerup", end);
      c.removeEventListener("pointercancel", end);
    };
  }, [method]);

  const clear = () => {
    const c = canvas.current;
    if (!c) return;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  };

  async function submit() {
    setError(null);
    if (method === "drawn" && !drawn) return setError("Draw your signature in the box, or switch to typing it.");
    setBusy(true);
    const err = await onSign({ name, method, consent, ...(method === "drawn" && { image: canvas.current!.toDataURL("image/png") }) });
    setBusy(false);
    if (err) setError(err);
    else onClose();
  }

  return (
    <dialog ref={dialog} className="sign-dialog" onClose={onClose} aria-labelledby="sign-h">
      <h2 id="sign-h">Sign: {label}</h2>
      <div className="field">
        <label htmlFor="sign-name">Your full name</label>
        <input id="sign-name" value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} />
      </div>
      <nav className="chips" aria-label="How to sign">
        <button type="button" className="chip" aria-current={method === "drawn" ? "page" : undefined} onClick={() => setMethod("drawn")}>Draw</button>
        <button type="button" className="chip" aria-current={method === "typed" ? "page" : undefined} onClick={() => setMethod("typed")}>Type</button>
      </nav>
      {method === "drawn" ? (
        <div className="stack" style={{ gap: 6 }}>
          <canvas ref={canvas} className="sign-pad" aria-label="Draw your signature here" />
          <div className="row"><span className="small muted">Sign with your finger or mouse.</span><span className="spacer" /><button type="button" className="btn small" onClick={clear}>Clear</button></div>
        </div>
      ) : (
        <div className="ob-answer"><span className="ob-typed">{name || "Your name"}</span></div>
      )}
      <label className="check" style={{ alignItems: "start" }}>
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
        <span className="small">{consentText}</span>
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={busy || !consent || name.trim().length < 2} onClick={submit}>{busy ? "Signing…" : "Sign"}</button>
        <button type="button" className="btn" onClick={() => dialog.current?.close()}>Cancel</button>
      </div>
    </dialog>
  );
}
