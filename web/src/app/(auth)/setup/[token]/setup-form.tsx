"use client";

import { useActionState, useState } from "react";
import { Status, type FormState } from "@/components/status";

const ZONES: Array<[string, string]> = [
  ["America/New_York", "Eastern"],
  ["America/Chicago", "Central"],
  ["America/Denver", "Mountain"],
  ["America/Phoenix", "Arizona"],
  ["America/Los_Angeles", "Pacific"],
  ["America/Anchorage", "Alaska"],
  ["Pacific/Honolulu", "Hawaii"],
];

export function SetupForm({
  action,
  payerEmail,
  payerName,
  site,
  contact,
}: {
  action: (s: FormState, fd: FormData) => Promise<FormState>;
  payerEmail: string;
  payerName: string;
  site: string;
  contact: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [homes, setHomes] = useState([0]);
  const [next, setNext] = useState(1);
  if (state.message) {
    return (
      <div className="stack" role="status">
        <h1>You&apos;re all set</h1>
        <p className="notice" style={{ margin: 0 }}>{state.message}</p>
        <p className="muted" style={{ margin: 0 }}>
          Open that email to set your password and two-step verification, then sign in. You can close this page. Not there after a few minutes? Check spam.
          Wrong address? Email <a href={`mailto:${contact}`}>{contact}</a>.
        </p>
      </div>
    );
  }
  return (
    <>
    <h1>Set up your organization</h1>
    <p className="muted">
      Your free trial has started. Add your organization and homes; you can add more homes later. The owner gets an email to set a password and two-step
      verification.
    </p>
    <form action={formAction} className="stack">
      <div className="field">
        <label htmlFor="orgName">Organization name</label>
        <input id="orgName" name="orgName" autoComplete="organization" required maxLength={120} />
      </div>
      <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Homes</legend>
        {homes.map((k, i) => (
          <div key={k} className="card" style={{ padding: 12, gap: 8 }}>
            <div className="field">
              <label htmlFor={`hn${k}`}>Home {i + 1} name</label>
              <input id={`hn${k}`} name="homeName" required={i === 0} maxLength={120} placeholder="Cedar Ridge" />
            </div>
            <div className="row" style={{ alignItems: "end" }}>
              <div className="field" style={{ flex: "2 1 160px" }}>
                <label htmlFor={`ht${k}`}>Time zone</label>
                <select id={`ht${k}`} name="homeTz" defaultValue="America/Chicago">{ZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              </div>
              <div className="field" style={{ flex: "1 1 90px" }}>
                <label htmlFor={`hb${k}`}>Beds</label>
                <input id={`hb${k}`} name="homeBeds" inputMode="numeric" defaultValue="6" />
              </div>
              {homes.length > 1 && <button type="button" className="btn small" onClick={() => setHomes(homes.filter((x) => x !== k))}>Remove</button>}
            </div>
          </div>
        ))}
        {homes.length < 20 && (
          <button type="button" className="btn small" style={{ justifySelf: "start" }} onClick={() => { setHomes([...homes, next]); setNext(next + 1); }}>
            Add another home
          </button>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="ownerName">Owner&apos;s full name</label>
        <input id="ownerName" name="ownerName" autoComplete="name" required defaultValue={payerName} />
      </div>
      <div className="field">
        <label htmlFor="ownerEmail">Owner&apos;s work email</label>
        <input id="ownerEmail" name="ownerEmail" type="email" autoComplete="email" required defaultValue={payerEmail} aria-describedby="ownerEmailHint" />
        <span id="ownerEmailHint" className="small muted">The sign-in link goes here. Filled in from PayPal; change it if the owner uses a different address.</span>
      </div>
      <label className="check" style={{ alignItems: "start" }}>
        <input type="checkbox" name="accepted" required />
        <span className="small">
          I accept the <a href={`${site}/terms`} target="_blank" rel="noreferrer">Terms of Service</a> and the{" "}
          <a href={`${site}/baa`} target="_blank" rel="noreferrer">Business Associate Agreement</a> on behalf of this organization.
        </span>
      </label>
      <Status state={state} />
      <button className="btn primary" disabled={pending}>{pending ? "Setting up…" : "Create organization"}</button>
    </form>
    </>
  );
}
