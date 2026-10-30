"use client";

import { useActionState, useState } from "react";
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
        <fieldset className="field" style={{ flex: "1 1 220px", border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 700 }}>Used at</legend>
          <HomeChecks homes={homes} checked={homes.length === 1 ? [homes[0].id] : []} />
        </fieldset>
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

function HomeChecks({ homes, checked }: { homes: Array<{ id: string; name: string }>; checked: string[] }) {
  return (
    <div className="row" style={{ gap: 12 }}>
      {homes.map((h) => (
        <label key={h.id} className="check"><input type="checkbox" name="facilityIds" value={h.id} defaultChecked={checked.includes(h.id)} /> {h.name}</label>
      ))}
    </div>
  );
}

/** Change which homes a registered tablet is used at, for example when it moves or is shared. */
export function DeviceHomesForm({ action, deviceId, name, homes, current }: { action: Action; deviceId: string; name: string; homes: Array<{ id: string; name: string }>; current: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  // Open from the state it was opened at; a successful save (a new state with a message) closes it.
  const [openedAt, setOpenedAt] = useState<FormState | null>(null);
  const open = openedAt !== null && !(state !== openedAt && state.message);
  if (!open) {
    return (
      <span>
        {current.map((h) => h.name).join(", ")}{" "}
        <button type="button" className="linkbtn small" onClick={() => setOpenedAt(state)} aria-label={`Change the homes ${name} is used at`}>Change</button>
        {state.message && <Status state={state} />}
      </span>
    );
  }
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 220 }}>
      <input type="hidden" name="deviceId" value={deviceId} />
      <HomeChecks homes={homes} checked={current.map((h) => h.id)} />
      <span className="small muted">Saving signs out anyone using {name}.</span>
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Save</button>
        <button type="button" className="btn small" onClick={() => setOpenedAt(null)}>Cancel</button>
      </div>
    </form>
  );
}

export function RevokeDeviceButton({ action, deviceId, name }: { action: Action; deviceId: string; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Remove "${name}"? Anyone signed in on it is signed out, and caregivers can no longer start shifts on it.`)) e.preventDefault();
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
