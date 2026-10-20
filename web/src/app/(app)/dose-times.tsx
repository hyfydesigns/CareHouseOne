"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { clock } from "@/lib/time";

const MAX = 12;
const GAP = 60;
const QUICK = ["08:00", "12:00", "17:00", "20:00"];

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));

/** Whether a time is within an hour of any already chosen (including across midnight). */
function tooClose(t: string, times: string[]): string | null {
  const m = toMin(t);
  return times.find((x) => {
    const d = Math.abs(toMin(x) - m);
    return Math.min(d, 1440 - d) < GAP;
  }) ?? null;
}

/**
 * Dose times for a scheduled order: any time of day. Each chosen time is sent as a "times" field;
 * the server re-checks everything (valid times, at most 12, at least an hour apart).
 */
export function DoseTimes() {
  const id = useId();
  const [times, setTimes] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);

  function add(t: string) {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) return setNote("Choose a time first.");
    if (times.includes(t)) return setNote(`${clock(t)} is already added.`);
    if (times.length >= MAX) return setNote(`At most ${MAX} times a day.`);
    const near = tooClose(t, times);
    if (near) return setNote(`${clock(t)} is less than an hour from ${clock(near)}. Doses of the same medication must be at least 1 hour apart.`);
    setTimes([...times, t].sort());
    setDraft("");
    setNote(null);
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault(); // add the time, don't submit the order
      add(draft);
    }
  }

  return (
    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }} aria-describedby={`${id}-hint`}>
      <legend>Times</legend>
      {times.map((t) => <input key={t} type="hidden" name="times" value={t} />)}
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "0 1 170px" }}>
          <label htmlFor={`${id}-t`} className="small">Add a time</label>
          <input id={`${id}-t`} type="time" step={60} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
        </div>
        <button type="button" className="btn" onClick={() => add(draft)}>Add time</button>
        <span className="small muted">Quick add:</span>
        {QUICK.filter((q) => !times.includes(q)).map((q) => (
          <button key={q} type="button" className="btn small" onClick={() => add(q)}>{clock(q)}</button>
        ))}
      </div>
      <div className="chips" aria-live="polite">
        {times.length === 0 ? (
          <span className="small muted">No times yet. Add each time the dose is due.</span>
        ) : (
          times.map((t) => (
            <span key={t} className="chip" style={{ gap: 6 }}>
              <b>{clock(t)}</b>
              <button type="button" className="linkbtn" aria-label={`Remove ${clock(t)}`} onClick={() => setTimes(times.filter((x) => x !== t))}>
                ✕
              </button>
            </span>
          ))
        )}
      </div>
      {note && <p className="error" role="alert" style={{ margin: 0 }}>{note}</p>}
      <p id={`${id}-hint`} className="small muted" style={{ margin: 0 }}>
        Any time of day, in the home&apos;s time zone. At least 1 hour apart, up to {MAX} a day.
      </p>
    </fieldset>
  );
}
