"use client";

import { useActionState } from "react";
import type { FormState } from "./actions";

type Action = (state: FormState, fd: FormData) => Promise<FormState>;

function Status({ state }: { state: FormState }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="notice" role="status">{state.message}</p>;
  return null;
}

export function SignInForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}

export function CodeForm({ action, label }: { action: Action; label: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      <div className="field">
        <label htmlFor="code">6-digit code</label>
        <input id="code" name="code" className="code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="\d{6}" required autoFocus />
      </div>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>{pending ? "Checking…" : label}</button>
    </form>
  );
}

export function EmailForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      <div className="field">
        <label htmlFor="email">Work email</label>
        <input id="email" name="email" type="email" autoComplete="username" required />
      </div>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>Send reset link</button>
    </form>
  );
}

export function NewPasswordForm({ action, submit }: { action: Action; submit: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      <p className="muted small">At least 12 characters. Passwords found in data breaches are blocked. A short phrase is easiest to remember.</p>
      <div className="field">
        <label htmlFor="password">New password</label>
        <input id="password" name="password" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <div className="field">
        <label htmlFor="confirm">Repeat new password</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={12} required />
      </div>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>{submit}</button>
    </form>
  );
}
