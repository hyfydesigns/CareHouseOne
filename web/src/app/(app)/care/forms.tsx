"use client";

import { useActionState, useState } from "react";
import { useOfflineSubmit } from "@/components/offline";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function VitalsForm({ action, residentId, lastReading }: { action: Action; residentId: string; lastReading?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const offline = useOfflineSubmit("vitals");
  const field = (id: string, label: string, mode: "numeric" | "decimal" = "numeric") => (
    <div className="field" style={{ flex: "1 1 140px" }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} inputMode={mode} autoComplete="off" />
    </div>
  );
  return (
    <form action={formAction} onSubmit={offline.onSubmit} className="card">
      <h2>Record vital signs</h2>
      {lastReading && <p className="small muted" style={{ margin: 0 }}>Last reading: {lastReading}</p>}
      <input type="hidden" name="residentId" value={residentId} />
      <div className="row" style={{ alignItems: "start" }}>
        {field("systolic", "BP top number")}
        {field("diastolic", "BP bottom number")}
        {field("pulse", "Pulse")}
        {field("temperature", "Temperature °F", "decimal")}
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        {field("respirations", "Breaths per minute")}
        {field("oxygen", "Oxygen %")}
        {field("weight", "Weight lb", "decimal")}
        <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="vnote">Note (optional)</label><input id="vnote" name="note" /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Blood pressure and pulse are required. Readings outside the usual range are flagged for the nurse.</p>
      <Status state={offline.saved ? { message: offline.saved } : state} />
      <div className="row"><button className="btn primary big" disabled={pending}>Save vital signs</button></div>
    </form>
  );
}

const CATEGORIES: Array<[string, string]> = [["general", "General"], ["activity", "Activity"], ["health", "Health"], ["behavior", "Behavior"], ["family_contact", "Family contact"]];

export function NoteForm({ action, residentId, shift, firstName }: { action: Action; residentId: string; shift: string; firstName: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const offline = useOfflineSubmit("note");
  return (
    <form action={formAction} onSubmit={offline.onSubmit} className="card">
      <h2>New progress note</h2>
      <input type="hidden" name="residentId" value={residentId} />
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 160px" }}>
          <label htmlFor="shift">Shift</label>
          <select id="shift" name="shift" defaultValue={shift}><option value="day">Day</option><option value="evening">Evening</option><option value="night">Night</option></select>
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="category">Type</label>
          <select id="category" name="category">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="body">Note</label>
        <textarea id="body" name="body" rows={4} required placeholder={`Write facts: what you saw, what you did, and how ${firstName} responded.`} />
      </div>
      <Status state={offline.saved ? { message: offline.saved } : state} />
      <div className="row"><button className="btn primary big" disabled={pending}>Save note</button></div>
    </form>
  );
}

export function AddendumButton({ action, residentId, noteId, shift, category }: { action: Action; residentId: string; noteId: string; shift: string; category: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="linkbtn small" onClick={() => setOpen(true)}>Add an addendum</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="addendumTo" value={noteId} />
      <input type="hidden" name="shift" value={shift} />
      <input type="hidden" name="category" value={category} />
      <label className="small" htmlFor={`add-${noteId}`}>Addendum (notes can&apos;t be edited; add the correction here)</label>
      <textarea id={`add-${noteId}`} name="body" rows={2} required />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Save addendum</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function ReviewButton({ action, vitalId, residentId }: { action: Action; vitalId: string; residentId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) return <span className="pill ok">Reviewed</span>;
  return (
    <form action={formAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <input type="hidden" name="vitalId" value={vitalId} />
      <input type="hidden" name="residentId" value={residentId} />
      <input name="note" placeholder="Follow-up (optional)" aria-label="Follow-up note" style={{ minWidth: 160 }} />
      <button className="btn small" disabled={pending}>Mark reviewed</button>
      <Status state={state} />
    </form>
  );
}

export function AddDiagnosisButton({ action, residentId, code, description }: { action: Action; residentId: string; code: string; description: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Select</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 260 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="code" value={code} />
      <label className="small" htmlFor={`lbl-${code}`}>Plain-language name for caregivers</label>
      <input id={`lbl-${code}`} name="label" defaultValue={description} />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Add diagnosis</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function RemoveDiagnosisButton({ action, residentId, diagnosisId, code }: { action: Action; residentId: string; diagnosisId: string; code: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Remove</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 220 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="diagnosisId" value={diagnosisId} />
      <label className="small" htmlFor={`rm-${diagnosisId}`}>Why is {code} being removed?</label>
      <input id={`rm-${diagnosisId}`} name="reason" placeholder="Resolved, or entered in error" />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small danger" disabled={pending}>Remove</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Keep</button>
      </div>
    </form>
  );
}

export function ShiftButton({ action, signedIn, tabletHome }: { action: Action; signedIn: boolean; tabletHome: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const blocked = !signedIn && !tabletHome;
  return (
    <form action={formAction} className="stack">
      <div className="row">
        <button className={`btn big ${signedIn ? "" : "primary"}`} name="op" value={signedIn ? "out" : "in"} disabled={pending || blocked} style={{ minWidth: 220 }}>
          {signedIn ? "Sign out" : tabletHome ? `Sign in at ${tabletHome}` : "Sign in"}
        </button>
      </div>
      {blocked && <p className="small muted" style={{ margin: 0 }}>Shift sign-in works on the home&apos;s registered tablet, so your hours are recorded at the right home.</p>}
      <Status state={state} />
    </form>
  );
}
