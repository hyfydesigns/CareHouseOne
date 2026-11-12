"use client";

import { useActionState, useState, useTransition } from "react";
import { Status, type FormState } from "@/components/status";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

/** A form whose fields are passed in as children; shows the action's error or message. */
export function ActionForm({ action, submit, children, className = "stack", danger }: { action: Action; submit: string; children: React.ReactNode; className?: string; danger?: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className={className}>
      {children}
      <Status state={state} />
      <button className={`btn ${danger ? "danger" : "primary"}`} disabled={pending} style={{ justifySelf: "start" }}>
        {pending ? "Working…" : submit}
      </button>
    </form>
  );
}

/** A button for an action that needs no fields, with an optional confirmation. */
export function ActionButton({ action, label, confirmText, small = true, ask }: { action: (note?: string) => Promise<FormState>; label: string; confirmText?: string; small?: boolean; ask?: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  return (
    <span style={{ display: "inline-grid", gap: 4 }}>
      <button
        type="button"
        className={`btn${small ? " small" : ""}`}
        disabled={pending}
        onClick={() => {
          let note: string | undefined;
          if (ask) {
            const answer = window.prompt(ask);
            if (answer === null) return;
            note = answer;
          } else if (confirmText && !window.confirm(confirmText)) return;
          start(async () => setState(await action(note)));
        }}
      >
        {pending ? "…" : label}
      </button>
      <Status state={state} />
    </span>
  );
}

/** The admin's setup page: password twice, then the code from the authenticator app just scanned. */
export function SetupForm({ action }: { action: Action }) {
  return (
    <ActionForm action={action} submit="Finish setup">
      <p className="muted small" style={{ margin: 0 }}>At least 12 characters. Passwords found in data breaches are blocked.</p>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="field">
        <label htmlFor="confirm">Repeat password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="field">
        <label htmlFor="code">6-digit code from the app</label>
        <input id="code" name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required />
      </div>
    </ActionForm>
  );
}
