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

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function RegisterDeviceForm({ action, homes }: { action: Action; homes: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack">
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId">{homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </div>
        <div className="field" style={{ flex: "2 1 240px" }}>
          <label htmlFor="name">Tablet name</label>
          <input id="name" name="name" placeholder="Med room tablet" maxLength={60} required />
        </div>
        <button className="btn primary" disabled={pending}>Register this tablet</button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function RevokeDeviceButton({ action, deviceId, name }: { action: Action; deviceId: string; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Remove "${name}"? Anyone signed in on it is signed out, and shift sign-in stops working there.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="deviceId" value={deviceId} />
      <button className="btn small" disabled={pending}>Remove</button>
      <Status state={state} />
    </form>
  );
}

export function ForgetDeviceButton({ action }: { action: () => Promise<FormState> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction}>
      <button className="btn small" disabled={pending}>Unmark this browser</button>
      <Status state={state} />
    </form>
  );
}
