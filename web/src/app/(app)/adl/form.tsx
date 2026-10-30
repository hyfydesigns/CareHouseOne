"use client";

import { useActionState, useState } from "react";
import { Icon } from "@/components/icon";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

/**
 * One row per activity with big tap targets for the level of help. Rows already recorded this
 * shift start on what was recorded; saving again records a correction.
 */
export function AdlForm(props: {
  action: Action;
  residentId: string;
  firstName: string;
  shift: string;
  activities: Array<[string, string]>;
  levels: Array<[string, string]>;
  current: Record<string, string>;
}) {
  const [state, formAction, pending] = useActionState(props.action, {});
  const [picked, setPicked] = useState<Record<string, string>>(props.current);
  const refused = Object.values(picked).includes("refused");
  return (
    <form action={formAction} className="card" key={state.message}>
      <h2>{props.firstName}&apos;s daily care · {props.shift} shift</h2>
      <p className="small muted" style={{ margin: 0 }}>Tap how much help was needed. Fill in what you did this shift; you can save some now and the rest later.</p>
      <input type="hidden" name="residentId" value={props.residentId} />
      <div className="adl-rows">
        {props.activities.map(([a, label]) => (
          <fieldset key={a} className="adl-row">
            <legend>{label}</legend>
            <div className="adl-levels">
              {props.levels.map(([v, l]) => (
                <label key={v} className={`adl-level${picked[a] === v ? " on" : ""}${v === "refused" ? " refused" : ""}`}>
                  <input type="radio" name={`a_${a}`} value={v} checked={picked[a] === v} onChange={() => setPicked((p) => ({ ...p, [a]: v }))} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
      <div className="field">
        <label htmlFor="adlNote">{refused ? "What was refused, and what you tried" : "Note (optional)"}</label>
        <input id="adlNote" name="note" maxLength={1000} required={refused} placeholder={refused ? "For example: refused shower, offered again at 7 PM and he agreed to a sponge bath" : "Anything the next shift should know"} />
      </div>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}><Icon name="check" size={20} />Save daily care</button></div>
    </form>
  );
}
