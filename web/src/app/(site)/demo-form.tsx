"use client";

import { useActionState } from "react";
import { Status, type FormState } from "@/components/status";

export function DemoForm({ action }: { action: (s: FormState, fd: FormData) => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) {
    return (
      <div className="card" role="status">
        <h3>Thanks, we&apos;ll be in touch</h3>
        <p className="muted" style={{ margin: 0 }}>{state.message}</p>
      </div>
    );
  }
  return (
    <form action={formAction}>
      <div className="two">
        <div className="field"><label htmlFor="d-name">Your name</label><input id="d-name" name="name" autoComplete="name" required /></div>
        <div className="field"><label htmlFor="d-email">Work email</label><input id="d-email" name="email" type="email" autoComplete="email" required /></div>
      </div>
      <div className="field"><label htmlFor="d-org">Organization</label><input id="d-org" name="organization" autoComplete="organization" required /></div>
      <div className="two">
        <div className="field"><label htmlFor="d-homes">Number of homes</label><input id="d-homes" name="homes" inputMode="numeric" /></div>
        <div className="field"><label htmlFor="d-res">Number of residents</label><input id="d-res" name="residents" inputMode="numeric" /></div>
      </div>
      <div className="field">
        <label htmlFor="d-msg">Anything we should know? (optional)</label>
        <textarea id="d-msg" name="message" rows={3} maxLength={2000} />
      </div>
      <div aria-hidden="true" style={{ position: "absolute", left: -9999, width: 1, height: 1, overflow: "hidden" }}>
        <label>Leave this empty<input name="website" tabIndex={-1} autoComplete="off" /></label>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Please don&apos;t include anything about residents. We only use these details to arrange your demo.</p>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Request a demo"}</button>
    </form>
  );
}
