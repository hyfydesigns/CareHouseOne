"use client";

import { useActionState } from "react";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function AddActivityForm({ action }: { action: Action }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack" key={state.message}>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="adlName">Add an activity</label>
          <input id="adlName" name="name" required maxLength={60} placeholder="For example: Laundry, Exercise, Bedtime routine" />
        </div>
        <button className="btn primary" disabled={pending}>Add</button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function ToggleActivityButton({ action, hidden, name }: { action: Action; hidden: boolean; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="row" style={{ gap: 6, justifyContent: "end" }}>
      <button className="btn small" disabled={pending} aria-label={`${hidden ? "Show" : "Hide"} ${name}`}>{hidden ? "Show" : "Hide"}</button>
      {state.error && <Status state={state} />}
    </form>
  );
}
