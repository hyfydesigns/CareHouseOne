"use client";

import { useActionState, useState } from "react";
import { Status, type FormState } from "@/components/status";
import { Icon } from "@/components/icon";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

/** Opens from the state it was opened at; a successful save (a new state with a message) closes it. */
function useOpen(state: FormState) {
  const [openedAt, setOpenedAt] = useState<FormState | null>(null);
  const open = openedAt !== null && !(state !== openedAt && state.message);
  return { open, show: () => setOpenedAt(state), hide: () => setOpenedAt(null) };
}

export function HandoffForm({ action, facilityId, home }: { action: Action; facilityId: string; home: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="stack" key={state.message}>
      <input type="hidden" name="facilityId" value={facilityId} />
      <div className="field">
        <label htmlFor="handoff">Note for the next shift at {home}</label>
        <textarea id="handoff" name="body" rows={3} required maxLength={2000} placeholder="For example: Ben didn't eat lunch, offer a snack. Lena's daughter is visiting at 6. Van needs gas." />
      </div>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}><Icon name="notes" size={20} />Save handoff note</button></div>
    </form>
  );
}

export function SafetyCheckForm(props: { action: Action; homes: Array<{ id: string; name: string; today: string; now: string }>; kinds: Array<[string, string]>; defaultHome: string }) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [home, setHome] = useState(props.defaultHome);
  const [kind, setKind] = useState("fire_drill");
  const h = props.homes.find((x) => x.id === home) ?? props.homes[0];
  return (
    <form action={formAction} className="card" key={state.message}>
      <h2>Record a safety check</h2>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="sHome">Home</label>
          <select id="sHome" name="facilityId" value={home} onChange={(e) => setHome(e.target.value)}>{props.homes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label htmlFor="sKind">What was done</label>
          <select id="sKind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{props.kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        <div className="field" style={{ flex: "0 1 170px" }}>
          <label htmlFor="sDate">Date</label>
          <input id="sDate" name="date" type="date" required defaultValue={h.today} max={h.today} key={`d${home}`} />
        </div>
        <div className="field" style={{ flex: "0 1 140px" }}>
          <label htmlFor="sTime">Time</label>
          <input id="sTime" name="time" type="time" required defaultValue={h.now} key={`t${home}`} />
        </div>
      </div>
      {kind === "fire_drill" && (
        <div className="row" style={{ alignItems: "start" }}>
          <div className="field" style={{ flex: "0 1 200px" }}>
            <label htmlFor="sPeople">Residents who took part</label>
            <input id="sPeople" name="participants" inputMode="numeric" />
          </div>
          <div className="field" style={{ flex: "0 1 220px" }}>
            <label htmlFor="sMins">Minutes to get everyone out</label>
            <input id="sMins" name="durationMinutes" inputMode="numeric" />
          </div>
        </div>
      )}
      <div className="field">
        <label htmlFor="sIssues">{kind === "other" ? "What was checked, and any problems" : "Problems found and what was done (optional)"}</label>
        <textarea id="sIssues" name="issues" rows={2} maxLength={2000} placeholder={kind === "fire_drill" ? "For example: Ben needed help with his walker on the steps." : "For example: replaced the battery in the hallway detector."} />
      </div>
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={pending}>Save</button></div>
    </form>
  );
}

type ApptValues = { date: string; time: string; provider?: string; purpose?: string; location?: string | null; notes?: string | null };

function AppointmentFields({ v, prefix }: { v: ApptValues; prefix: string }) {
  return (
    <>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "0 1 170px" }}><label htmlFor={`${prefix}d`}>Date</label><input id={`${prefix}d`} name="date" type="date" required defaultValue={v.date} /></div>
        <div className="field" style={{ flex: "0 1 140px" }}><label htmlFor={`${prefix}t`}>Time</label><input id={`${prefix}t`} name="time" type="time" required defaultValue={v.time} /></div>
        <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor={`${prefix}p`}>With</label><input id={`${prefix}p`} name="provider" required maxLength={200} defaultValue={v.provider} placeholder="For example: Dr. Patel, family doctor" /></div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "2 1 240px" }}><label htmlFor={`${prefix}w`}>What for</label><input id={`${prefix}w`} name="purpose" required maxLength={300} defaultValue={v.purpose} placeholder="For example: blood pressure follow-up" /></div>
        <div className="field" style={{ flex: "2 1 240px" }}><label htmlFor={`${prefix}l`}>Where (optional)</label><input id={`${prefix}l`} name="location" maxLength={300} defaultValue={v.location ?? ""} /></div>
      </div>
      <div className="field"><label htmlFor={`${prefix}n`}>Notes (optional)</label><input id={`${prefix}n`} name="notes" maxLength={1000} defaultValue={v.notes ?? ""} placeholder="For example: fasting from midnight, bring insurance card, staff to drive" /></div>
    </>
  );
}

export function AppointmentForm({ action, today, label = "Add an appointment" }: { action: Action; today: string; label?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const { open, show, hide } = useOpen(state);
  return (
    <>
      {state.message && !open && <Status state={state} />}
      {!open ? (
        <button className="btn" style={{ justifySelf: "start" }} onClick={show}>{label}</button>
      ) : (
        <form action={formAction} className="card">
          <h2>{label}</h2>
          <AppointmentFields v={{ date: today, time: "09:00" }} prefix="na" />
          <Status state={state} />
          <div className="row"><button type="button" className="btn" onClick={hide}>Cancel</button><button className="btn primary" disabled={pending}>Save</button></div>
        </form>
      )}
    </>
  );
}

export function RescheduleButton({ action, v, id }: { action: Action; v: ApptValues; id: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const { open, show, hide } = useOpen(state);
  if (!open) return <button className="linkbtn small" onClick={show}>Change</button>;
  return (
    <form action={formAction} className="stack" style={{ minWidth: 300 }}>
      <AppointmentFields v={v} prefix={`r${id}`} />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" onClick={hide}>Cancel</button><button className="btn small primary" disabled={pending}>Save</button></div>
    </form>
  );
}

export function OutcomeButton({ action, id }: { action: Action; id: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const { open, show, hide } = useOpen(state);
  const [status, setStatus] = useState("done");
  if (state.message && !open) return <Status state={state} />;
  if (!open) return <button className="btn small" onClick={show}>Record how it went</button>;
  return (
    <form action={formAction} className="stack" style={{ minWidth: 280 }}>
      <div className="row" style={{ gap: 6 }}>
        {[["done", "It happened"], ["cancelled", "Cancelled"], ["missed", "Missed"]].map(([v, l]) => (
          <label key={v} className="chip" style={{ gap: 6, cursor: "pointer" }}><input type="radio" name="status" value={v} checked={status === v} onChange={() => setStatus(v)} /> {l}</label>
        ))}
      </div>
      <div className="field">
        <label htmlFor={`o${id}`}>{status === "done" ? "What the provider said or did" : "Why"}</label>
        <textarea id={`o${id}`} name="outcome" rows={3} required />
      </div>
      {status === "done" && (
        <div className="field">
          <label htmlFor={`f${id}`}>Follow-up needed (optional)</label>
          <input id={`f${id}`} name="followUp" maxLength={1000} placeholder="For example: new prescription, blood test in 2 weeks, next visit in 3 months" />
        </div>
      )}
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}><button type="button" className="btn small" onClick={hide}>Cancel</button><button className="btn small primary" disabled={pending}>Save</button></div>
    </form>
  );
}

export function CertificationForm(props: { action: Action; people: Array<{ id: string; name: string }>; kinds: Array<[string, string]>; defaultUser?: string }) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [kind, setKind] = useState("med_cert");
  return (
    <form action={formAction} className="card" key={state.message}>
      <h2>Add training or a certification</h2>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="cUser">Person</label>
          <select id="cUser" name="userId" defaultValue={props.defaultUser ?? props.people[0]?.id}>{props.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        </div>
        <div className="field" style={{ flex: "2 1 260px" }}>
          <label htmlFor="cKind">Training or certification</label>
          <select id="cKind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>{props.kinds.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
        {kind === "other" && <div className="field" style={{ flex: "2 1 200px" }}><label htmlFor="cLabel">Name</label><input id="cLabel" name="label" required maxLength={120} /></div>}
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "0 1 180px" }}><label htmlFor="cIssued">Completed on</label><input id="cIssued" name="issuedOn" type="date" /></div>
        <div className="field" style={{ flex: "0 1 180px" }}><label htmlFor="cExp">Expires on</label><input id="cExp" name="expiresOn" type="date" /></div>
        <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="cNotes">Notes (optional)</label><input id="cNotes" name="notes" maxLength={500} placeholder="Provider, certificate number" /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Leave the expiry date empty for training that doesn&apos;t expire. Owners, admins and the person get an email 30 days before and on the day it expires.</p>
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={pending}>Add</button></div>
    </form>
  );
}

export function RemoveCertButton({ action, name }: { action: Action; name: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) return <span className="small muted">Removed</span>;
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!confirm(`Remove ${name}? Only for a mistake or an old record replaced by a renewal.`)) e.preventDefault();
      }}
    >
      <button className="linkbtn small" disabled={pending}>Remove</button>
      <Status state={state} />
    </form>
  );
}
