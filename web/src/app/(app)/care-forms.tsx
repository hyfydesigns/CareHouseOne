"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { ScanField } from "@/components/scan-field";
import { ResidentPhoto } from "@/components/resident-photo";
import { DoseTimes } from "./dose-times";
import { TabletCount } from "./tablet-count";
import { MedNameField } from "./med-name-field";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export interface ResidentValues {
  facilityId: string;
  firstName: string;
  lastName: string;
  room: string;
  allergies: string[];
  diet: string;
  codeStatus: string;
  dateOfBirth: string | null;
  admittedOn: string | null;
  guardian: string | null;
  guardianRelationship: string | null;
  guardianPhone: string | null;
  guardianEmail: string | null;
  emergencyName: string | null;
  emergencyRelationship: string | null;
  emergencyPhone: string | null;
}

/** The same fields for adding and editing a resident. */
function ResidentFields({ homes, v }: { homes: Array<{ id: string; name: string }>; v?: ResidentValues }) {
  return (
    <>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" required defaultValue={v?.firstName} /></div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" required defaultValue={v?.lastName} /></div>
        <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor="room">Room</label><input id="room" name="room" defaultValue={v?.room} /></div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId" defaultValue={v?.facilityId}>{homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "2 1 260px" }}>
          <label htmlFor="allergies">Allergies</label>
          <input id="allergies" name="allergies" placeholder="Separate with commas, for example: Penicillin (hives), Latex" defaultValue={v?.allergies.join(", ")} />
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="diet">Diet</label><input id="diet" name="diet" defaultValue={v?.diet ?? "Regular"} /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="codeStatus">Code status</label><input id="codeStatus" name="codeStatus" defaultValue={v?.codeStatus ?? "Full code"} /></div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={v?.dateOfBirth ?? ""} /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="admittedOn">Living here since</label><input id="admittedOn" name="admittedOn" type="date" defaultValue={v?.admittedOn ?? ""} /></div>
      </div>
      <fieldset className="form-section">
        <legend>Guardian</legend>
        <p className="hint">Name, relationship and phone show on the resident&apos;s page for caregivers. The email is only shown here.</p>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="guardian">Name</label><input id="guardian" name="guardian" autoComplete="off" defaultValue={v?.guardian ?? ""} /></div>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="guardianRelationship">Relationship</label>
            <input id="guardianRelationship" name="guardianRelationship" autoComplete="off" placeholder="For example: Brother, Court-appointed" defaultValue={v?.guardianRelationship ?? ""} />
          </div>
          <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="guardianPhone">Phone</label><input id="guardianPhone" name="guardianPhone" type="tel" autoComplete="off" defaultValue={v?.guardianPhone ?? ""} /></div>
          <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="guardianEmail">Email</label><input id="guardianEmail" name="guardianEmail" type="email" autoComplete="off" defaultValue={v?.guardianEmail ?? ""} /></div>
        </div>
      </fieldset>
      <fieldset className="form-section">
        <legend>Emergency contact</legend>
        <p className="hint">Optional. Someone to call in an emergency, in addition to the guardian.</p>
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="emergencyName">Name</label><input id="emergencyName" name="emergencyName" autoComplete="off" defaultValue={v?.emergencyName ?? ""} /></div>
          <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="emergencyRelationship">Relationship</label><input id="emergencyRelationship" name="emergencyRelationship" autoComplete="off" defaultValue={v?.emergencyRelationship ?? ""} /></div>
          <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="emergencyPhone">Phone</label><input id="emergencyPhone" name="emergencyPhone" type="tel" autoComplete="off" defaultValue={v?.emergencyPhone ?? ""} /></div>
        </div>
      </fieldset>
    </>
  );
}

export function AddResidentForm({ action, homes }: { action: Action; homes: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Add a resident</h2>
      <ResidentFields homes={homes} />
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={pending}>Add resident</button></div>
    </form>
  );
}

export function EditResidentForm({ action, homes, values }: { action: Action; homes: Array<{ id: string; name: string }>; values: ResidentValues }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Resident details</h2>
      <p className="small muted" style={{ margin: 0 }}>Allergies drive the medication safety stops, so keep them up to date. Every change is recorded in the audit log.</p>
      <ResidentFields homes={homes} v={values} />
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={pending}>Save changes</button></div>
    </form>
  );
}

export function DischargeForm({ action, today, name }: { action: Action; today: string; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Discharge {name}</button>;
  return (
    <form action={formAction} className="card" style={{ borderColor: "var(--crit)" }}>
      <h2>Discharge {name}</h2>
      <p className="small muted" style={{ margin: 0 }}>
        They leave the medication pass and the tablet. Nothing is deleted: their records stay readable under Residents, and they can be readmitted.
      </p>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "0 1 180px" }}><label htmlFor="dDate">Discharge date</label><input id="dDate" name="date" type="date" required defaultValue={today} /></div>
        <div className="field" style={{ flex: "2 1 280px" }}><label htmlFor="dReason">Reason</label><input id="dReason" name="reason" required maxLength={300} placeholder="For example: moved to another provider" /></div>
      </div>
      <Status state={state} />
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
        <button className="btn danger" disabled={pending}>Discharge</button>
      </div>
    </form>
  );
}

export function ReadmitForm({ action, today }: { action: Action; today: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Readmit</h2>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "0 1 180px" }}><label htmlFor="rDate">Readmission date</label><input id="rDate" name="date" type="date" required defaultValue={today} /></div>
        <button className="btn primary" disabled={pending}>Readmit</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Check their medication orders before the next medication pass.</p>
      <Status state={state} />
    </form>
  );
}

const ROUTES = ["By mouth", "Under the tongue", "Topical", "Inhaled", "Eye drops", "Ear drops", "Nasal", "Injection", "Rectal", "G-tube", "Patch"];

export function AddOrderForm({ action, today, allergies }: { action: Action; today: string; allergies: string[] }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [type, setType] = useState<"scheduled" | "prn">("scheduled");
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn primary" onClick={() => setOpen(true)}>Add medication</button>;
  return (
    <form action={formAction} className="card" style={{ borderColor: "var(--accent)" }}>
      <h2>Add medication</h2>
      <p className="small muted">Enter it exactly as the prescriber ordered. Allergies on file: {allergies.length ? allergies.join(", ") : "none known"}.</p>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "2 1 200px" }}><label htmlFor="name">Medication</label><MedNameField /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="strength">Strength and form</label><input id="strength" name="strength" required placeholder="10 mg tablet" /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="route">Route</label><select id="route" name="route">{ROUTES.map((r) => <option key={r}>{r}</option>)}</select></div>
        <div className="field" style={{ flex: "2 1 200px" }}><label htmlFor="purpose">What it&apos;s for</label><input id="purpose" name="purpose" required placeholder="Blood pressure" /></div>
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="sr-only">Type of order</legend>
        <label className="check"><input type="radio" name="type" value="scheduled" checked={type === "scheduled"} onChange={() => setType("scheduled")} /> Scheduled</label>
        <label className="check"><input type="radio" name="type" value="prn" checked={type === "prn"} onChange={() => setType("prn")} /> As needed (PRN)</label>
      </fieldset>
      {type === "scheduled" ? (
        <>
          <DoseTimes />
          <label className="check"><input type="checkbox" name="bpCheck" /> Check blood pressure before each dose (hold if the top number is under 100)</label>
        </>
      ) : (
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "2 1 260px" }}><label htmlFor="prnReasons">Reasons to give</label><input id="prnReasons" name="prnReasons" placeholder="Headache, Fever over 100.4 °F" /></div>
          <div className="field" style={{ flex: "1 1 140px" }}><label htmlFor="prnMinIntervalHours">Hours apart (at least)</label><input id="prnMinIntervalHours" name="prnMinIntervalHours" type="number" min={1} max={24} defaultValue={6} /></div>
          <div className="field" style={{ flex: "1 1 140px" }}><label htmlFor="prnMaxPerDay">Most doses a day</label><input id="prnMaxPerDay" name="prnMaxPerDay" type="number" min={1} max={12} defaultValue={4} /></div>
        </div>
      )}
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 150px" }}><label htmlFor="startDate">Start date</label><input id="startDate" name="startDate" type="date" defaultValue={today} required /></div>
        <div className="field" style={{ flex: "1 1 150px" }}><label htmlFor="stopDate">Stop date (optional)</label><input id="stopDate" name="stopDate" type="date" /></div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="prescriber">Prescriber</label><input id="prescriber" name="prescriber" /></div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="packageCode">Package barcode (optional)</label><input id="packageCode" name="packageCode" /></div>
      </div>
      <div className="field"><label htmlFor="instructions">Instructions for caregivers (optional)</label><input id="instructions" name="instructions" placeholder="Give with food" /></div>
      <TabletCount />
      <Status state={state} />
      <div className="row">
        <button className="btn primary" disabled={pending}>Add medication</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
      </div>
    </form>
  );
}

/** Owners and admins: add a refill or correct the count (with a reason). */
export function CountAdjust({ action, orderId, residentId, counted }: { action: Action; orderId: string; residentId: string; counted: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"add" | "set">(counted ? "add" : "set");
  if (!open) {
    return (
      <div className="row" style={{ gap: 6 }}>
        {counted && <button type="button" className="btn small" onClick={() => { setMode("add"); setOpen(true); }}>Add refill</button>}
        <button type="button" className="btn small" onClick={() => { setMode("set"); setOpen(true); }}>{counted ? "Correct count" : "Start counting"}</button>
        <Status state={state} />
      </div>
    );
  }
  return (
    <form action={formAction} className="stack" style={{ gap: 8, maxWidth: 360 }}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="mode" value={mode} />
      <div className="field">
        <label htmlFor={`amt-${orderId}`}>{mode === "add" ? "Tablets received" : "Tablets on hand now"}</label>
        <input id={`amt-${orderId}`} name="amount" type="number" min={0} max={10000} step={0.5} inputMode="decimal" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor={`why-${orderId}`}>{mode === "add" ? "Note (optional)" : "Reason"}</label>
        <input id={`why-${orderId}`} name="reason" maxLength={200} required={mode === "set"} placeholder={mode === "add" ? "For example: pharmacy delivery" : "For example: counted by hand"} />
      </div>
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Save</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Close</button>
      </div>
    </form>
  );
}

export function StopOrderButton({ action, orderId, residentId, name }: { action: Action; orderId: string; residentId: string; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [confirm, setConfirm] = useState(false);
  if (!confirm) return <button className="btn small" onClick={() => setConfirm(true)}>Stop</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 240 }}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="residentId" value={residentId} />
      <label className="small" htmlFor={`why-${orderId}`}><b>Stop {name}?</b> It comes off the medication pass. Its record stays.</label>
      <input id={`why-${orderId}`} name="reason" placeholder="Reason, for example: stopped by Dr. Alvarez" />
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className="btn small" onClick={() => setConfirm(false)}>Keep</button>
        <button className="btn small danger" disabled={pending}>Stop medication</button>
      </div>
      <Status state={state} />
    </form>
  );
}

/**
 * Submits without React's automatic form reset, so what the caregiver typed (codes, blood pressure)
 * is still there after a safety stop. The clicked button's name/value is included.
 */
function keepValues(formAction: (fd: FormData) => void) {
  return (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    const fd = new FormData(e.currentTarget, submitter);
    startTransition(() => formAction(fd));
  };
}

export type ResidentCheckMode = "two_identifiers" | "wristband";
export type Who = { name: string; dateOfBirth: string | null; room: string; photo: string | null };

/** Step 1 of every dose: confirm the right person, by wristband scan or two identifiers. */
function ResidentCheck({ mode, who, step }: { mode: ResidentCheckMode; who: Who; step: string }) {
  const second = who.dateOfBirth ? `date of birth ${who.dateOfBirth}` : `room ${who.room} (no date of birth on file)`;
  // The photo first, so the caregiver looks from the screen to the person before anything else.
  const face = (
    <div className="who">
      <ResidentPhoto src={who.photo} name={who.name} size={104} />
      <span>
        <b>{who.name}</b>
        <br />
        <span className="small muted">Room {who.room}{who.dateOfBirth ? ` · Born ${who.dateOfBirth}` : ""}</span>
        <br />
        <span className="small">{who.photo ? "Look at the person: is this them?" : "No photo on file yet. Ask an owner or admin to add one."}</span>
      </span>
    </div>
  );
  if (mode === "wristband") {
    return (
      <>
        {face}
        <ScanField id="residentCode" name="residentCode" label={`${step}Scan the resident's wristband`} hint="Or the code on their room card." autoFocus />
      </>
    );
  }
  return (
    <>
      {face}
      <label className="check" style={{ alignItems: "start" }}>
        <input type="checkbox" name="residentConfirmed" required />
        <span>{step}I&apos;ve checked two identifiers: this is <b>{who.name}</b>, {second}.</span>
      </label>
    </>
  );
}

function useBackOnSuccess(state: FormState, back: string) {
  const router = useRouter();
  useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(() => router.push(back), 1500);
    return () => clearTimeout(t);
  }, [state.message, back, router]);
}

export function GiveForm({ action, orderId, scheduledFor, hasPackageCode, bpCheck, label, back, mode, who }: { action: Action; orderId: string; scheduledFor: string; hasPackageCode: boolean; bpCheck: boolean; label: string; back: string; mode: ResidentCheckMode; who: Who }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [outcome, setOutcome] = useState<"given" | "refused" | "held">("given");
  useBackOnSuccess(state, back);
  if (state.message) return <Status state={state} />;
  return (
    <form onSubmit={keepValues(formAction)} className="stack">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="scheduledFor" value={scheduledFor} />
      <ResidentCheck mode={mode} who={who} step="1. " />
      {hasPackageCode ? (
        <ScanField id="packageCode" name="packageCode" label="2. Scan the medication package" />
      ) : (
        <label className="check"><input type="checkbox" name="packageConfirmed" /> 2. The package label matches {label}</label>
      )}
      {bpCheck && (
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend>3. Blood pressure (required before this medication)</legend>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <input name="bpSystolic" inputMode="numeric" aria-label="Top number" placeholder="Top" />
            <span>/</span>
            <input name="bpDiastolic" inputMode="numeric" aria-label="Bottom number" placeholder="Bottom" />
          </div>
          <span className="small muted">If the top number is under 100, hold the dose.</span>
        </fieldset>
      )}
      {outcome !== "given" && (
        <div className="field">
          <label htmlFor="reason">{outcome === "refused" ? "What happened?" : "Why was it held?"}</label>
          <input id="reason" name="reason" required />
        </div>
      )}
      <div className="field"><label htmlFor="note">Note (optional)</label><input id="note" name="note" /></div>
      <Status state={state} />
      <div className="row">
        {outcome === "given" ? (
          <>
            <button className="btn primary big" name="outcome" value="given" disabled={pending}>Give</button>
            <button type="button" className="btn" onClick={() => setOutcome("refused")}>Refused</button>
            <button type="button" className="btn" onClick={() => setOutcome("held")}>Held</button>
          </>
        ) : (
          <>
            <button className="btn danger" name="outcome" value={outcome} disabled={pending}>Record as {outcome}</button>
            <button type="button" className="btn" onClick={() => setOutcome("given")}>Back</button>
          </>
        )}
      </div>
    </form>
  );
}

export function PrnForm({ action, orderId, hasPackageCode, reasons, label, back, mode, who }: { action: Action; orderId: string; hasPackageCode: boolean; reasons: string[]; label: string; back: string; mode: ResidentCheckMode; who: Who }) {
  const [state, formAction, pending] = useActionState(action, {});
  useBackOnSuccess(state, back);
  if (state.message) return <Status state={state} />;
  return (
    <form onSubmit={keepValues(formAction)} className="stack">
      <input type="hidden" name="orderId" value={orderId} />
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Why are you giving it?</legend>
        {reasons.map((r) => <label key={r} className="check"><input type="radio" name="reason" value={r} required /> {r}</label>)}
      </fieldset>
      <ResidentCheck mode={mode} who={who} step="" />
      {hasPackageCode ? (
        <ScanField id="packageCode" name="packageCode" label="Scan the medication package" />
      ) : (
        <label className="check"><input type="checkbox" name="packageConfirmed" /> The package label matches {label}</label>
      )}
      <div className="field"><label htmlFor="note">Note (optional)</label><input id="note" name="note" /></div>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}>Give as needed</button></div>
    </form>
  );
}

export function FollowupForm({ action, followupId, residentId }: { action: Action; followupId: string; residentId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) return <Status state={state} />;
  return (
    <form action={formAction} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="followupId" value={followupId} />
      <input type="hidden" name="residentId" value={residentId} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small" name="result" value="not_effective" disabled={pending}>Not effective</button>
        <button className="btn small" name="result" value="partly_effective" disabled={pending}>Partly</button>
        <button className="btn small primary" name="result" value="effective" disabled={pending}>Effective</button>
      </div>
      <Status state={state} />
    </form>
  );
}
