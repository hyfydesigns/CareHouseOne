"use client";

import { useActionState } from "react";
import { Status, type FormState } from "@/components/status";

export function ResidentCheckForm({ action, current }: { action: (s: FormState, fd: FormData) => Promise<FormState>; current: "two_identifiers" | "wristband" }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Confirming the right person before medications</h2>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Resident check</legend>
        <label className="check" style={{ alignItems: "start" }}>
          <input type="radio" name="residentCheck" value="two_identifiers" defaultChecked={current === "two_identifiers"} />
          <span>
            <b>Two identifiers</b>
            <br />
            <span className="small muted">The caregiver checks the resident&apos;s name and date of birth and ticks a confirmation. No wristbands needed.</span>
          </span>
        </label>
        <label className="check" style={{ alignItems: "start" }}>
          <input type="radio" name="residentCheck" value="wristband" defaultChecked={current === "wristband"} />
          <span>
            <b>Wristband scan</b>
            <br />
            <span className="small muted">The caregiver must scan the resident&apos;s wristband or room card. Print cards from each resident&apos;s profile.</span>
          </span>
        </label>
      </fieldset>
      <p className="small muted">Either way, if someone scans a code, it must match the resident. Changes are recorded in the audit log.</p>
      <Status state={state} />
      <div className="row">
        <button className="btn primary" disabled={pending}>Save</button>
      </div>
    </form>
  );
}
