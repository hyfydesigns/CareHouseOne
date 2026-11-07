"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { OnboardingFormView } from "@/components/onboarding-form";
import { SignDialog } from "@/components/sign-dialog";
import { Status, type FormState } from "@/components/status";
import type { Audience, Block, Values } from "@/lib/onboarding-forms";
import type { ItemView } from "@/server/onboarding";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function StartOnboardingForm({ action, homes, forms, audience }: { action: Action; homes: Array<{ id: string; name: string }>; forms: Array<{ id: string; title: string; required: boolean; afterHire: boolean }>; audience: Audience }) {
  const [state, formAction, pending] = useActionState(action, {});
  const staff = audience === "staff";
  return (
    <form action={formAction} className="card" key={audience}>
      <h2>Start an onboarding</h2>
      <input type="hidden" name="audience" value={audience} />
      <p className="small muted" style={{ margin: 0 }}>{staff ? "The new hire gets an email with a private link to the checklist. Nothing is added to Staff until you hire them." : "The responsible party gets an email with a private link to the checklist. Nothing is added to Residents until you admit."}</p>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId" defaultValue={homes.length === 1 ? homes[0].id : ""} required>
            {homes.length > 1 && <option value="" disabled>Choose…</option>}
            {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="rf">{staff ? "First name" : "Resident first name"}</label><input id="rf" name="residentFirstName" maxLength={80} required /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="rl">{staff ? "Last name" : "Resident last name"}</label><input id="rl" name="residentLastName" maxLength={80} required /></div>
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        {!staff && <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="pn">Person or Responsible Party</label><input id="pn" name="poaName" maxLength={160} required /></div>}
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="pe">Their email</label><input id="pe" name="poaEmail" type="email" maxLength={200} required /></div>
      </div>
      <fieldset className="ob-pick">
        <legend>{staff ? "Forms this new hire needs" : "Forms this resident needs"}</legend>
        {forms.map((f) => (
          <label key={f.id} className="check"><input type="checkbox" name="formIds" value={f.id} defaultChecked /> {f.title}{!f.required && <span className="small muted"> (optional)</span>}{f.afterHire && <span className="small muted"> (after hire)</span>}</label>
        ))}
      </fieldset>
      <div className="row" style={{ gap: 6 }}>
        <button className="btn primary" name="intent" value="draft" disabled={pending}>Fill in the home&apos;s part first</button>
        <button className="btn" name="intent" value="send" disabled={pending}>Send the link now</button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Fill in first when a form has answers for the home to complete{staff ? ", like the position and hours in the job description" : ", like the fees and room in the agreement"}. {staff ? "They don't" : <>The family doesn&apos;t</>} see anything until you send the link.</p>
      <Status state={state} />
    </form>
  );
}

/** Send (a draft) or resend the link, or cancel, with a confirmation for sending and cancelling. */
export function PacketButtons({ resend, cancel, send, sendWarning }: { resend?: () => Promise<FormState>; cancel?: () => Promise<FormState>; send?: () => Promise<FormState>; sendWarning?: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<FormState>) => {
    setBusy(true);
    setState(await fn());
    setBusy(false);
    router.refresh();
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ gap: 6 }}>
        {send && <button type="button" className="btn small primary" disabled={busy} onClick={() => confirm(sendWarning ?? "Send the link now?") && run(send)}>Send the link</button>}
        {resend && <button type="button" className="btn small" disabled={busy} onClick={() => run(resend)}>Send a new link</button>}
        {cancel && <button type="button" className="btn small" disabled={busy} onClick={() => confirm("Cancel this onboarding? Their link stops working. Nothing is deleted.") && run(cancel)}>Cancel onboarding</button>}
      </div>
      <Status state={state} />
    </div>
  );
}

/** One checklist item as staff see it: the family's or employee's answers, the home's fields and signatures, and review. */
export function StaffItem({
  packetId,
  item,
  open,
  draft = false,
  audience = "resident",
  me,
  consentText,
  save,
  sign,
  review,
}: {
  packetId: string;
  item: ItemView;
  open: boolean;
  /** Not sent to the family yet: the home fills in its part, nothing to review. */
  draft?: boolean;
  audience?: Audience;
  me: string;
  consentText: string;
  save: (values: Values) => Promise<FormState>;
  sign: (blockId: string, s: { name: string; method: string; image?: string; consent: boolean }) => Promise<FormState>;
  review: (decision: "approve" | "changes", note: string) => Promise<FormState>;
}) {
  const router = useRouter();
  // Only what's changed here: the family may be filling in the same form.
  const [edits, setEdits] = useState<Values>({});
  const values = { ...item.values, ...edits };
  const dirty = Object.keys(edits).length > 0;
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<Extract<Block, { type: "signature" }> | null>(null);
  const editable = open && item.status !== "approved";
  const signatures = Object.fromEntries(Object.entries(item.signatures).map(([k, s]) => [k, { name: s.name, image: s.image, signedAt: new Date(s.signedAt).toLocaleString() }]));
  const hasStaffPart = item.blocks.some((b) => (b.type === "field" || b.type === "signature") && b.who === "staff");
  const hasFields = item.blocks.some((b) => b.type === "field");
  const person = audience === "staff" ? "the employee" : "the family";

  async function doSave(): Promise<boolean> {
    if (!dirty) return true;
    const r = await save(edits);
    setState(r);
    if (!r.error) setEdits({});
    router.refresh();
    return !r.error;
  }

  return (
    <div className="stack">
      {item.kind === "form" ? (
        <OnboardingFormView
          blocks={item.blocks}
          values={values}
          who="staff"
          onChange={editable ? (id, v) => setEdits((x) => ({ ...x, [id]: v })) : undefined}
          answerAll
          audience={audience}
          signatures={signatures}
          onSign={editable ? async (b) => ((await doSave()) ? setSigning(b) : undefined) : undefined}
          disabled={busy}
        />
      ) : item.files.length ? (
        <ul className="stack" style={{ listStyle: "none", padding: 0, margin: 0, gap: 6 }}>
          {item.files.map((f) => (
            <li key={f.id} className="attach-chip">
              <span className="attach-pdf" aria-hidden="true">{f.contentType === "application/pdf" ? "PDF" : "IMG"}</span>
              <a href={`/api/onboarding/files/${f.id}`} target="_blank" rel="noreferrer">{f.filename}</a>
              <span className="small muted">{(f.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>Nothing uploaded yet.</p>
      )}
      {editable && hasStaffPart && item.status === "todo" && !Object.keys(item.signatures).length && (
        <p className="small muted" style={{ margin: 0 }}>Tip: fill in the home&apos;s part before {person} signs. Changing an answer clears the signatures on its part of the form, and on any part that quotes it.</p>
      )}
      <Status state={state} />
      {editable && draft && item.kind === "form" && hasFields && (
        <div className="row"><button type="button" className="btn small primary" disabled={busy || !dirty} onClick={async () => { setBusy(true); await doSave(); setBusy(false); }}>Save answers</button></div>
      )}
      {editable && !draft && (
        <div className="row" style={{ gap: 6 }}>
          {item.kind === "form" && hasFields && <button type="button" className="btn small" disabled={busy || !dirty} onClick={async () => { setBusy(true); await doSave(); setBusy(false); }}>Save answers</button>}
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={async () => {
              const note = prompt(`What needs changing? ${audience === "staff" ? "The employee" : "The family"} sees this note.`);
              if (!note) return;
              setBusy(true);
              setState(await review("changes", note));
              setBusy(false);
              router.refresh();
            }}
          >
            Ask for changes
          </button>
          <button type="button" className="btn small give" disabled={busy} onClick={async () => { setBusy(true); if (await doSave()) setState(await review("approve", "")); setBusy(false); router.refresh(); }}>Approve</button>
        </div>
      )}
      {item.kind === "form" && Object.keys(item.signatures).length > 0 && (
        <a className="small" href={`/api/onboarding/items/${item.id}/pdf?packet=${packetId}`} target="_blank" rel="noreferrer">Preview the signed PDF</a>
      )}
      {signing && (
        <SignDialog
          label={signing.label}
          defaultName={me}
          consentText={consentText}
          onClose={() => setSigning(null)}
          onSign={async (s) => {
            const r = await sign(signing.id, s);
            if (r.error) return r.error;
            setState(r);
            router.refresh();
            return null;
          }}
        />
      )}
    </div>
  );
}

/** Hiring: their role and homes; the account, invitation and documents follow. */
export function HireForm({ action, name, email, roles, homes, homeId }: { action: Action; name: string; email: string; roles: Array<{ value: string; label: string }>; homes: Array<{ id: string; name: string }>; homeId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Hire</h2>
      <p className="small muted" style={{ margin: 0 }}>Hiring creates {name}&apos;s staff account, sends their invitation to {email}, puts the approved forms and documents on their record, and emails them a link to their signed copies and the forms they&apos;ll do on the job.</p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label htmlFor="hire-role">Role</label>
        <select id="hire-role" name="role" defaultValue="" required>
          <option value="" disabled>Choose…</option>
          {roles.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
      </div>
      <fieldset className="ob-pick">
        <legend>Homes</legend>
        {homes.map((h) => <label key={h.id} className="check"><input type="checkbox" name="facilityIds" value={h.id} defaultChecked={h.id === homeId} /> {h.name}</label>)}
      </fieldset>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}>Hire and send the invitation</button></div>
    </form>
  );
}

export function AdmitForm({ action, suggested }: { action: Action; suggested: Record<string, string> }) {
  const [state, formAction, pending] = useActionState(action, {});
  const f = (name: string, label: string, opts: { type?: string; required?: boolean; flex?: string } = {}) => (
    <div className="field" style={{ flex: opts.flex ?? "1 1 180px" }}>
      <label htmlFor={`ad-${name}`}>{label}</label>
      <input id={`ad-${name}`} name={name} type={opts.type ?? "text"} defaultValue={suggested[name] ?? ""} required={opts.required} />
    </div>
  );
  return (
    <form action={formAction} className="card">
      <h2>Admit</h2>
      <p className="small muted" style={{ margin: 0 }}>Check the resident&apos;s details, filled in from the family&apos;s answers. Admitting creates the resident, puts every signed form and document on their Documents tab, and emails the family a link to their signed copies.</p>
      <div className="row" style={{ alignItems: "end" }}>
        {f("firstName", "First name", { required: true })}
        {f("lastName", "Last name", { required: true })}
        {f("dateOfBirth", "Date of birth", { type: "date" })}
        {f("room", "Room", { flex: "0 1 120px" })}
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        {f("allergies", "Allergies (comma-separated)", { flex: "2 1 260px" })}
        {f("diet", "Diet")}
        {f("admittedOn", "Admission date", { type: "date" })}
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        {f("guardian", "Guardian / POA")}
        {f("guardianRelationship", "Relationship")}
        {f("guardianPhone", "Phone")}
        {f("guardianEmail", "Email", { type: "email" })}
      </div>
      <Status state={state} />
      <div className="row"><button className="btn primary big" disabled={pending}>Admit and file the documents</button></div>
    </form>
  );
}
