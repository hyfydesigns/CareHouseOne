"use client";

import { useActionState, useState } from "react";
import { Status, type FormState } from "@/components/status";
import { ZONES } from "@/lib/time-zones";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;
export interface HomeRow {
  id: string;
  name: string;
  timeZone: string;
  beds: number;
  activeResidents: number;
  removable: boolean;
}

const zoneLabel = (tz: string) => ZONES.find(([v]) => v === tz)?.[1] ?? tz;

function HomeFields({ prefix, v }: { prefix: string; v?: Pick<HomeRow, "name" | "timeZone" | "beds"> }) {
  const zones = v && !ZONES.some(([z]) => z === v.timeZone) ? [...ZONES, [v.timeZone, v.timeZone] as [string, string]] : ZONES;
  return (
    <div className="row" style={{ alignItems: "start" }}>
      <div className="field" style={{ flex: "2 1 220px" }}>
        <label htmlFor={`${prefix}name`}>Home name</label>
        <input id={`${prefix}name`} name="name" defaultValue={v?.name} required maxLength={120} placeholder="For example: Oak House" />
      </div>
      <div className="field" style={{ flex: "1 1 160px" }}>
        <label htmlFor={`${prefix}tz`}>Time zone</label>
        <select id={`${prefix}tz`} name="timeZone" defaultValue={v?.timeZone ?? "America/Chicago"}>{zones.map(([z, l]) => <option key={z} value={z}>{l}</option>)}</select>
      </div>
      <div className="field" style={{ flex: "0 1 130px" }}>
        <label htmlFor={`${prefix}beds`}>Licensed beds</label>
        <input id={`${prefix}beds`} name="beds" inputMode="numeric" defaultValue={v?.beds ?? 6} />
      </div>
    </div>
  );
}

/** `costNote`: what a new home adds to the bill, or null for organizations billed by invoice. */
export function AddHomeForm({ action, costNote }: { action: Action; costNote: string | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button className="btn" style={{ justifySelf: "start" }} onClick={() => setOpen(true)}>Add a home</button>;
  return (
    <form action={formAction} className="card" key={state.message}>
      <h2>Add a home</h2>
      <HomeFields prefix="new-" />
      {costNote && <p className="small muted" style={{ margin: 0 }}>{costNote}</p>}
      <Status state={state} />
      <div className="row">
        <button type="button" className="btn" onClick={() => setOpen(false)}>Close</button>
        <button className="btn primary" disabled={pending}>Add home</button>
      </div>
    </form>
  );
}

export function HomeRowView({ home, update, remove }: { home: HomeRow; update: Action; remove: Action }) {
  const [state, formAction, pending] = useActionState(update, {});
  const [removeState, removeAction, removing] = useActionState(remove, {});
  // Open from the state it was opened at; a successful save (a new state with a message) closes it.
  const [openedAt, setOpenedAt] = useState<FormState | null>(null);
  const editing = openedAt !== null && !(state !== openedAt && state.message);
  if (editing) {
    return (
      <tr>
        <td colSpan={4}>
          <form action={formAction} className="stack">
            <HomeFields prefix={`${home.id}-`} v={home} />
            <Status state={state} />
            <div className="row" style={{ gap: 6 }}>
              <button className="btn small primary" disabled={pending}>Save</button>
              <button type="button" className="btn small" onClick={() => setOpenedAt(null)}>Cancel</button>
            </div>
          </form>
        </td>
      </tr>
    );
  }
  return (
    <tr>
      <td>{home.name}{state.message && <Status state={state} />}</td>
      <td>{zoneLabel(home.timeZone)}</td>
      <td>{home.activeResidents} of {home.beds} beds</td>
      <td style={{ textAlign: "right" }}>
        <div className="row" style={{ gap: 6, justifyContent: "end" }}>
          <button className="btn small" onClick={() => setOpenedAt(state)}>Edit</button>
          {home.removable && (
            <form
              action={removeAction}
              onSubmit={(e) => {
                if (!confirm(`Remove ${home.name}? Only do this for a home added by mistake.`)) e.preventDefault();
              }}
            >
              <button className="btn small danger" disabled={removing}>Remove</button>
            </form>
          )}
        </div>
        <Status state={removeState} />
      </td>
    </tr>
  );
}
