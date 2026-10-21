"use client";

import { useActionState, useState } from "react";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function IncidentForm(props: {
  action: Action;
  homes: Array<{ id: string; name: string; today: string; now: string }>;
  residents: Array<{ id: string; facilityId: string; name: string }>;
  types: Array<[string, string]>;
  reportable: string[];
  defaultHome: string;
  defaultResident?: string;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [home, setHome] = useState(props.defaultHome);
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [injury, setInjury] = useState(false);
  const h = props.homes.find((x) => x.id === home) ?? props.homes[0];
  const people = props.residents.filter((r) => r.facilityId === home);
  const reportable = props.reportable.includes(type) || severity === "serious";
  return (
    <form action={formAction} className="card">
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId" value={home} onChange={(e) => setHome(e.target.value)}>
            {props.homes.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label htmlFor="residentId">Resident involved</label>
          <select id="residentId" name="residentId" defaultValue={props.defaultResident ?? ""} key={home}>
            <option value="">No resident, or not a resident</option>
            {people.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
      </div>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "2 1 260px" }}>
          <label htmlFor="type">What happened</label>
          <select id="type" name="type" required value={type} onChange={(e) => setType(e.target.value)}>
            <option value="" disabled>Choose the kind of incident</option>
            {props.types.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <fieldset className="field" style={{ flex: "1 1 260px", border: 0, padding: 0, margin: 0 }}>
          <legend className="small" style={{ fontWeight: 700, marginBottom: 6 }}>How serious</legend>
          <div className="row" style={{ gap: 8 }}>
            {[["minor", "Minor"], ["moderate", "Moderate"], ["serious", "Serious"]].map(([v, l]) => (
              <label key={v} className="chip" style={{ minHeight: 44, gap: 8, cursor: "pointer" }}>
                <input type="radio" name="severity" value={v} required checked={severity === v} onChange={() => setSeverity(v)} /> {l}
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      {reportable && (
        <p className="notice" style={{ margin: 0 }}>
          This kind of incident usually has to be reported to the state licensing agency, often within 24 hours. Tell the owner or admin right away.
        </p>
      )}
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "0 1 180px" }}>
          <label htmlFor="date">Date it happened</label>
          <input id="date" name="date" type="date" required defaultValue={h.today} max={h.today} key={`d${home}`} />
        </div>
        <div className="field" style={{ flex: "0 1 150px" }}>
          <label htmlFor="time">Time</label>
          <input id="time" name="time" type="time" required defaultValue={h.now} key={`t${home}`} />
        </div>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor="location">Where (optional)</label>
          <input id="location" name="location" maxLength={200} placeholder="For example: bathroom, back yard, van" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="description">What happened</label>
        <textarea id="description" name="description" rows={5} required placeholder="Facts only: what you saw and heard, in order. Who was there. What the resident said." />
      </div>
      <div className="field">
        <label htmlFor="actionTaken">What was done right away</label>
        <textarea id="actionTaken" name="actionTaken" rows={3} required placeholder="For example: checked for injuries, applied ice, called 911, called the nurse." />
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Was anyone hurt?</legend>
        <div className="row" style={{ gap: 8 }}>
          <label className="chip" style={{ minHeight: 44, gap: 8, cursor: "pointer" }}><input type="radio" name="injury" value="no" checked={!injury} onChange={() => setInjury(false)} /> No</label>
          <label className="chip" style={{ minHeight: 44, gap: 8, cursor: "pointer" }}><input type="radio" name="injury" value="yes" checked={injury} onChange={() => setInjury(true)} /> Yes</label>
        </div>
      </fieldset>
      {injury && (
        <div className="field">
          <label htmlFor="injuryDetails">Describe the injury</label>
          <textarea id="injuryDetails" name="injuryDetails" rows={2} required placeholder="Where on the body, size, bleeding, swelling, pain." />
        </div>
      )}
      <div className="field">
        <label htmlFor="witnesses">Witnesses (optional)</label>
        <input id="witnesses" name="witnesses" maxLength={500} placeholder="Names of staff or others who saw it" />
      </div>
      <p className="small muted" style={{ margin: 0 }}>Once filed, a report can&apos;t be changed. The owner or admin adds follow-ups and corrections.</p>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}>File the report</button></div>
    </form>
  );
}

export function FollowupForm({ action, kinds, open }: { action: Action; kinds: Array<[string, string]>; open: boolean }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [kind, setKind] = useState(open ? "guardian_notified" : "reopened");
  const options = kinds.filter(([k]) => (open ? k !== "reopened" : k === "reopened" || k === "note"));
  const hint: Record<string, string> = {
    guardian_notified: "Who you spoke to, how (phone, email, in person) and what you told them.",
    physician_notified: "Who, and any instructions they gave.",
    state_notified: "Agency, how it was reported, and any reference number.",
    police_notified: "Department and report number.",
    note: "What was found or done since the report.",
    closed: "The outcome, and anything changed to stop it happening again.",
    reopened: "Why it's being reopened.",
  };
  return (
    <form action={formAction} className="card" key={state.message}>
      <h2>Add a follow-up</h2>
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="kind">What you&apos;re recording</label>
        <select id="kind" name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="details">Details</label>
        <textarea id="details" name="details" rows={3} placeholder={hint[kind]} />
      </div>
      <Status state={state} />
      <div className="row"><button className={`btn ${kind === "closed" ? "" : "primary"}`} disabled={pending}>{kind === "closed" ? "Close the report" : "Save"}</button></div>
    </form>
  );
}
