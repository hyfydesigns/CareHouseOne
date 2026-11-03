"use client";
/* eslint-disable @next/next/no-img-element -- signatures are data: URLs drawn on the page */

import { answerText, WHO_LABEL, WHO_PHRASE, withAnswers, type Block, type Values, type Who } from "@/lib/onboarding-forms";

export interface SignatureView {
  name: string;
  /** A drawn signature as a data: URL; typed signatures show the name in script. */
  image: string | null;
  signedAt: string;
}

/**
 * One onboarding form as someone fills it in. The person filling (`who`) gets inputs for their own
 * fields; everyone else's answers show as text, or as a line waiting for that person. With no
 * `onChange` it is read-only (preview, review).
 */
export function OnboardingFormView({
  blocks,
  values,
  who,
  onChange,
  signatures = {},
  onSign,
  disabled,
}: {
  blocks: Block[];
  values: Values;
  who: Who | null;
  onChange?: (id: string, value: string) => void;
  signatures?: Record<string, SignatureView>;
  onSign?: (block: Extract<Block, { type: "signature" }>) => void;
  disabled?: boolean;
}) {
  return (
    <div className="ob-form">
      {blocks.map((b) => {
        if (b.type === "heading") return <h3 key={b.id}>{withAnswers(b.text, blocks, values)}</h3>;
        if (b.type === "text") return <p key={b.id} className="ob-text">{withAnswers(b.text, blocks, values)}</p>;
        if (b.type === "signature") {
          const s = signatures[b.id];
          return (
            <div key={b.id} className={`ob-sign${s ? " signed" : ""}`}>
              <div className="ob-label">{b.label} <span className="ob-who">{WHO_LABEL[b.who]}</span></div>
              {s ? (
                <div className="ob-signature">
                  {s.image ? <img src={s.image} alt={`Signature of ${s.name}`} /> : <span className="ob-typed">{s.name}</span>}
                  <span className="small muted">Signed by {s.name} · {s.signedAt}</span>
                </div>
              ) : b.who === who && onSign ? (
                <button type="button" className="btn primary" disabled={disabled} onClick={() => onSign(b)}>Sign</button>
              ) : (
                <div className="ob-line">{b.who === who ? "Not signed yet" : `To be signed by ${WHO_PHRASE[b.who]}`}</div>
              )}
            </div>
          );
        }
        const mine = b.who === who && !!onChange;
        const v = values[b.id] ?? "";
        const inputId = `ob-${b.id}`;
        if (!mine) {
          return (
            <div key={b.id} className="ob-field">
              <div className="ob-label">{b.label}{b.required && b.input !== "check" ? " *" : ""} <span className="ob-who">{WHO_LABEL[b.who]}</span></div>
              <div className={v ? "ob-answer" : "ob-line"}>{v ? answerText(b, v) : b.who === who ? "Not answered" : `To be filled in by ${WHO_PHRASE[b.who]}`}</div>
            </div>
          );
        }
        const set = (x: string) => onChange!(b.id, x);
        if (b.input === "check") {
          return (
            <label key={b.id} className="check ob-field" style={{ alignItems: "start" }}>
              <input type="checkbox" checked={v === "yes"} disabled={disabled} onChange={(e) => set(e.target.checked ? "yes" : "")} />
              <span>{b.label}{b.required ? " *" : ""}{b.help && <><br /><span className="small muted">{b.help}</span></>}</span>
            </label>
          );
        }
        if (b.input === "yesno" || b.input === "choice") {
          const opts = b.input === "yesno" ? [["yes", "Yes"], ["no", "No"]] : (b.options ?? []).map((o) => [o, o]);
          return (
            <fieldset key={b.id} className="ob-field">
              <legend className="ob-label">{b.label}{b.required ? " *" : ""}</legend>
              {b.help && <div className="small muted">{b.help}</div>}
              <div className="row" style={{ gap: 8 }}>
                {opts.map(([val, label]) => (
                  <label key={val} className="chip" style={{ gap: 8, cursor: "pointer" }}>
                    <input type="radio" name={inputId} checked={v === val} disabled={disabled} onChange={() => set(val)} /> {label}
                  </label>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <div key={b.id} className="field ob-field">
            <label htmlFor={inputId}>{b.label}{b.required ? " *" : ""}</label>
            {b.help && <span className="small muted">{b.help}</span>}
            {b.input === "long" ? (
              <textarea id={inputId} rows={3} value={v} maxLength={4000} disabled={disabled} onChange={(e) => set(e.target.value)} />
            ) : (
              <input id={inputId} type={b.input === "date" ? "date" : "text"} value={v} maxLength={300} disabled={disabled} onChange={(e) => set(e.target.value)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
