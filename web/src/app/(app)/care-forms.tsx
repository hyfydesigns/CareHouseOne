"use client";

import { useRouter } from "next/navigation";
import { startTransition, useActionState, useEffect, useState, type FormEvent } from "react";
import { ScanField } from "@/components/scan-field";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function AddResidentForm({ action, homes }: { action: Action; homes: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Add a resident</h2>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="firstName">First name</label><input id="firstName" name="firstName" required /></div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="lastName">Last name</label><input id="lastName" name="lastName" required /></div>
        <div className="field" style={{ flex: "0 1 120px" }}><label htmlFor="room">Room</label><input id="room" name="room" /></div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId">{homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}</select>
        </div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "2 1 260px" }}><label htmlFor="allergies">Allergies</label><input id="allergies" name="allergies" placeholder="Separate with commas, for example: Penicillin (hives), Latex" /></div>
        <div className="field" style={{ flex: "1 1 180px" }}><label htmlFor="diet">Diet</label><input id="diet" name="diet" defaultValue="Regular" /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="codeStatus">Code status</label><input id="codeStatus" name="codeStatus" defaultValue="Full code" /></div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="dateOfBirth">Date of birth</label><input id="dateOfBirth" name="dateOfBirth" type="date" /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="admittedOn">Living here since</label><input id="admittedOn" name="admittedOn" type="date" /></div>
        <div className="field" style={{ flex: "2 1 260px" }}><label htmlFor="guardian">Guardian</label><input id="guardian" name="guardian" /></div>
      </div>
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={pending}>Add resident</button></div>
    </form>
  );
}

const ROUTES = ["By mouth", "Under the tongue", "Topical", "Inhaled", "Eye drops", "Ear drops", "Nasal", "Injection", "Rectal", "G-tube", "Patch"];
const TIMES = ["06:00", "08:00", "12:00", "14:00", "17:00", "20:00", "22:00"];

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
        <div className="field" style={{ flex: "2 1 200px" }}><label htmlFor="name">Medication</label><input id="name" name="name" required placeholder="For example: Lisinopril" /></div>
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
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend>Times</legend>
            <div className="row">{TIMES.map((t) => <label key={t} className="check"><input type="checkbox" name="times" value={t} /> {t}</label>)}</div>
          </fieldset>
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
      <Status state={state} />
      <div className="row">
        <button className="btn primary" disabled={pending}>Add medication</button>
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
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

function useBackOnSuccess(state: FormState, back: string) {
  const router = useRouter();
  useEffect(() => {
    if (!state.message) return;
    const t = setTimeout(() => router.push(back), 1500);
    return () => clearTimeout(t);
  }, [state.message, back, router]);
}

export function GiveForm({ action, orderId, scheduledFor, hasPackageCode, bpCheck, label, back }: { action: Action; orderId: string; scheduledFor: string; hasPackageCode: boolean; bpCheck: boolean; label: string; back: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [outcome, setOutcome] = useState<"given" | "refused" | "held">("given");
  useBackOnSuccess(state, back);
  if (state.message) return <Status state={state} />;
  return (
    <form onSubmit={keepValues(formAction)} className="stack">
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="scheduledFor" value={scheduledFor} />
      <ScanField id="residentCode" name="residentCode" label="1. Scan the resident's wristband" hint="Or the code on their room card." autoFocus />
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

export function PrnForm({ action, orderId, hasPackageCode, reasons, label, back }: { action: Action; orderId: string; hasPackageCode: boolean; reasons: string[]; label: string; back: string }) {
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
      <ScanField id="residentCode" name="residentCode" label="Scan the resident's wristband" />
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
