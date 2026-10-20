"use client";

import { useActionState, useState } from "react";
import type { Role } from "@/db/schema";
import { ROLE_LABEL } from "@/lib/permissions";
import type { StaffState } from "./actions";

type Action = (s: StaffState, fd: FormData) => Promise<StaffState>;

function Status({ state }: { state: StaffState }) {
  if (state.error) return <p className="error" role="alert">{state.error}</p>;
  if (state.message) return <p className="notice" role="status">{state.message}</p>;
  return null;
}

export function InviteForm({ action, roles, homes }: { action: Action; roles: Array<{ value: Role; label: string }>; homes: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Add staff</h2>
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 220px" }}>
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" required autoComplete="off" />
        </div>
        <div className="field" style={{ flex: "1 1 260px" }}>
          <label htmlFor="email">Work email</label>
          <input id="email" name="email" type="email" required autoComplete="off" />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="role">Role</label>
          <select id="role" name="role">
            {roles.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
      </div>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend>Homes</legend>
        <div className="row">
          {homes.map((h, i) => (
            <label key={h.id} className="check">
              <input type="checkbox" name="facilityIds" value={h.id} defaultChecked={i === 0 && homes.length === 1} /> {h.name}
            </label>
          ))}
        </div>
      </fieldset>
      <p className="muted small">
        They&apos;ll get an email with a link to set their password; it expires in 7 days. Owners and admins also turn on two-step verification. Caregivers
        sign in on their home&apos;s registered tablet with their password and a PIN, so they don&apos;t need an authenticator app.
      </p>
      <Status state={state} />
      <div className="row">
        <button className="btn primary" disabled={pending}>{pending ? "Sending…" : "Send invitation"}</button>
      </div>
    </form>
  );
}

export function RowActions({
  action,
  userId,
  name,
  status,
  rehireOnly,
  role,
  facilityIds,
  roles,
  homes,
}: {
  action: Action;
  userId: string;
  name: string;
  status: string;
  rehireOnly: boolean;
  role: Role;
  facilityIds: string[];
  roles: Array<{ value: Role; label: string }>;
  homes: Array<{ id: string; name: string }>;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const [confirming, setConfirming] = useState(false);
  const [editing, setEditing] = useState(false);
  // Someone whose role is no longer offered (an existing nurse, say) keeps it as an option.
  const options = roles.some((r) => r.value === role) ? roles : [...roles, { value: role, label: `${ROLE_LABEL[role]} (current)` }];
  return (
    <div className="stack" style={{ justifyItems: "end", gap: 6 }}>
      {status !== "deactivated" && !editing && !confirming && (
        <button className="btn small" aria-label={`Edit role or homes for ${name}`} onClick={() => setEditing(true)}>Edit</button>
      )}
      {editing && (
        <form action={formAction} className="stack" style={{ gap: 8, minWidth: 260, textAlign: "left" }}>
          <input type="hidden" name="userId" value={userId} />
          <div className="field">
            <label htmlFor={`role-${userId}`}>Role for {name}</label>
            <select id={`role-${userId}`} name="role" defaultValue={role}>
              {options.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="small">Homes</legend>
            {homes.map((h) => (
              <label key={h.id} className="check"><input type="checkbox" name="facilityIds" value={h.id} defaultChecked={facilityIds.includes(h.id)} /> {h.name}</label>
            ))}
          </fieldset>
          <p className="small muted" style={{ margin: 0 }}>Changing the role signs them out so they sign in again under the new role.</p>
          <div className="row" style={{ gap: 6, justifyContent: "end" }}>
            <button type="button" className="btn small" onClick={() => setEditing(false)}>Close</button>
            <button className="btn small primary" name="op" value="update" disabled={pending}>Save</button>
          </div>
        </form>
      )}
      {status === "invited" && (
        <form action={formAction} className="row" style={{ gap: 6 }}>
          <input type="hidden" name="userId" value={userId} />
          <button className="btn small" name="op" value="resend" disabled={pending}>Resend</button>
          <button className="btn small" name="op" value="cancel" disabled={pending}>Cancel invitation</button>
        </form>
      )}
      {status === "active" && !confirming && !editing && (
        <button className="btn small" onClick={() => setConfirming(true)}>Deactivate</button>
      )}
      {status === "active" && confirming && (
        <form action={formAction} className="stack" style={{ gap: 6, minWidth: 260 }}>
          <input type="hidden" name="userId" value={userId} />
          <label className="small" htmlFor={`reason-${userId}`}><b>Deactivate {name}?</b> They&apos;ll be signed out on every device. Their records stay.</label>
          <select id={`reason-${userId}`} name="reason" defaultValue="Resigned">
            <option>Resigned</option>
            <option>Employment ended</option>
            <option>Extended leave</option>
            <option>Other</option>
          </select>
          <div className="row" style={{ gap: 6, justifyContent: "end" }}>
            <button type="button" className="btn small" onClick={() => setConfirming(false)}>Keep</button>
            <button className="btn small danger" name="op" value="deactivate" disabled={pending}>Deactivate</button>
          </div>
        </form>
      )}
      {status === "deactivated" && !rehireOnly && (
        <form action={formAction}>
          <input type="hidden" name="userId" value={userId} />
          <button className="btn small" name="op" value="reactivate" disabled={pending}>Reactivate</button>
        </form>
      )}
      {status === "deactivated" && rehireOnly && <span className="small muted">Left over 12 months ago. Invite as a new hire.</span>}
      <Status state={state} />
    </div>
  );
}
