"use client";

import { useState } from "react";
import { OnboardingFormView } from "@/components/onboarding-form";
import { Status, type FormState } from "@/components/status";
import { FORM_KINDS, INPUTS, newBlockId, PLACEHOLDERS, WHO_LABEL, type Block, type FormDef, type FormKind, type InputKind, type Who } from "@/lib/onboarding-forms";

type Save = (form: FormDef) => Promise<FormState>;

const ADD: Array<[string, () => Block]> = [
  ["Heading", () => ({ id: newBlockId(), type: "heading", text: "" })],
  ["Paragraph", () => ({ id: newBlockId(), type: "text", text: "" })],
  ["Question", () => ({ id: newBlockId(), type: "field", label: "", input: "text", required: true, who: "poa" })],
  ["Signature line", () => ({ id: newBlockId(), type: "signature", label: "Power of attorney or guardian", who: "poa" })],
];

/** Owners and admins write a form: headings, paragraphs, questions and signature lines. */
export function FormEditor({ initial, save }: { initial: FormDef; save: Save }) {
  const [form, setForm] = useState<FormDef>(initial);
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(false);
  const [sample, setSample] = useState<Record<string, string>>({});

  const setBlock = (i: number, b: Block) => setForm((f) => ({ ...f, blocks: f.blocks.map((x, k) => (k === i ? b : x)) }));
  const move = (i: number, d: -1 | 1) =>
    setForm((f) => {
      const j = i + d;
      if (j < 0 || j >= f.blocks.length) return f;
      const blocks = [...f.blocks];
      [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
      return { ...f, blocks };
    });
  const remove = (i: number) => setForm((f) => ({ ...f, blocks: f.blocks.filter((_, k) => k !== i) }));

  async function onSave() {
    setBusy(true);
    setState(await save(form));
    setBusy(false);
  }

  return (
    <div className="stack">
      <section className="card">
        <div className="row" style={{ alignItems: "end" }}>
          <div className="field" style={{ flex: "2 1 260px" }}>
            <label htmlFor="ftitle">Title</label>
            <input id="ftitle" value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="field" style={{ flex: "1 1 200px" }}>
            <label htmlFor="fkind">What it asks for</label>
            <select id="fkind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as FormKind })}>
              {Object.entries(FORM_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="fdesc">{form.kind === "upload" ? "What to upload (the family sees this)" : "Short description (the family sees this in the checklist)"}</label>
          <input id="fdesc" value={form.description} maxLength={1000} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <label className="check"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Required before the resident can be admitted</label>
      </section>

      {form.kind === "form" && (
        <section className="card">
          <div className="row">
            <h2 style={{ margin: 0 }}>{preview ? "Preview: what the family sees" : "Contents"}</h2>
            <span className="spacer" />
            <button type="button" className="btn small" onClick={() => setPreview(!preview)}>{preview ? "Back to editing" : "Preview"}</button>
          </div>
          {preview ? (
            <OnboardingFormView blocks={form.blocks} values={sample} who="poa" onChange={(id, v) => setSample((s) => ({ ...s, [id]: v }))} onSign={() => alert("The family signs here, by drawing or typing their name.")} />
          ) : (
            <>
              {form.blocks.map((b, i) => (
                <div key={b.id} className="ob-edit">
                  <div className="row" style={{ gap: 6 }}>
                    <b className="small">{b.type === "heading" ? "Heading" : b.type === "text" ? "Paragraph" : b.type === "field" ? "Question" : "Signature line"}</b>
                    <span className="spacer" />
                    <button type="button" className="btn small" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">↑</button>
                    <button type="button" className="btn small" onClick={() => move(i, 1)} disabled={i === form.blocks.length - 1} aria-label="Move down">↓</button>
                    <button type="button" className="btn small" onClick={() => remove(i)} aria-label="Remove">Remove</button>
                  </div>
                  <BlockEditor block={b} onChange={(nb) => setBlock(i, nb)} />
                </div>
              ))}
              <p className="small muted" style={{ margin: 0 }}>
                In headings and paragraphs, these are filled in from the home chosen for each onboarding: {PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")}. A question&apos;s own label in double braces, like {"{{Monthly fee}}"}, shows its answer.
              </p>
              <div className="row" style={{ gap: 6 }}>
                <span className="small muted">Add:</span>
                {ADD.map(([label, make]) => <button key={label} type="button" className="btn small" onClick={() => setForm((f) => ({ ...f, blocks: [...f.blocks, make()] }))}>+ {label}</button>)}
              </div>
            </>
          )}
        </section>
      )}
      {form.kind === "upload" && <p className="muted">The family uploads photos or PDFs for this item, and staff check them before admission.</p>}

      <Status state={state} />
      <div className="row"><button type="button" className="btn primary" disabled={busy} onClick={onSave}>{busy ? "Saving…" : "Save form"}</button></div>
      <p className="small muted" style={{ margin: 0 }}>Families who were already sent this form keep the version they received; changes apply to new onboardings.</p>
    </div>
  );
}

function WhoSelect({ value, onChange, id }: { value: Who; onChange: (w: Who) => void; id: string }) {
  return (
    <div className="field" style={{ flex: "0 1 170px" }}>
      <label htmlFor={id}>Completed by</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Who)}>
        {Object.entries(WHO_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  );
}

function BlockEditor({ block: b, onChange }: { block: Block; onChange: (b: Block) => void }) {
  if (b.type === "heading") return <input aria-label="Heading" value={b.text} maxLength={200} placeholder="Heading" onChange={(e) => onChange({ ...b, text: e.target.value })} />;
  if (b.type === "text") return <textarea aria-label="Paragraph" rows={4} value={b.text} maxLength={8000} placeholder="Terms, explanations or instructions" onChange={(e) => onChange({ ...b, text: e.target.value })} />;
  if (b.type === "signature") {
    return (
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor={`l${b.id}`}>Who signs (label)</label>
          <input id={`l${b.id}`} value={b.label} maxLength={200} onChange={(e) => onChange({ ...b, label: e.target.value })} />
        </div>
        <WhoSelect id={`w${b.id}`} value={b.who} onChange={(who) => onChange({ ...b, who })} />
      </div>
    );
  }
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "3 1 260px" }}>
          <label htmlFor={`q${b.id}`}>Question</label>
          <input id={`q${b.id}`} value={b.label} maxLength={300} onChange={(e) => onChange({ ...b, label: e.target.value })} />
        </div>
        <div className="field" style={{ flex: "1 1 170px" }}>
          <label htmlFor={`t${b.id}`}>Answer type</label>
          <select id={`t${b.id}`} value={b.input} onChange={(e) => onChange({ ...b, input: e.target.value as InputKind, ...(e.target.value === "choice" && !b.options?.length && { options: ["", ""] }) })}>
            {Object.entries(INPUTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <WhoSelect id={`w${b.id}`} value={b.who} onChange={(who) => onChange({ ...b, who })} />
      </div>
      {b.input === "choice" && (
        <div className="field">
          <label htmlFor={`o${b.id}`}>Choices, one per line</label>
          <textarea id={`o${b.id}`} rows={3} value={(b.options ?? []).join("\n")} onChange={(e) => onChange({ ...b, options: e.target.value.split("\n") })} />
        </div>
      )}
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "3 1 260px" }}>
          <label htmlFor={`h${b.id}`}>Help text (optional)</label>
          <input id={`h${b.id}`} value={b.help ?? ""} maxLength={300} onChange={(e) => onChange({ ...b, help: e.target.value || undefined })} />
        </div>
        <label className="check"><input type="checkbox" checked={b.required} onChange={(e) => onChange({ ...b, required: e.target.checked })} /> Required</label>
      </div>
    </div>
  );
}
