"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState } from "react";
import { OnboardingFormView } from "@/components/onboarding-form";
import { SignDialog } from "@/components/sign-dialog";
import { Status, type FormState } from "@/components/status";
import type { Block, Values } from "@/lib/onboarding-forms";
import type { ItemView } from "@/server/onboarding";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function StartOnboardingForm({ action, homes }: { action: Action; homes: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="card">
      <h2>Start an onboarding</h2>
      <p className="small muted" style={{ margin: 0 }}>The power of attorney gets an email with a private link to the checklist. Nothing is added to Residents until you admit.</p>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="facilityId">Home</label>
          <select id="facilityId" name="facilityId" defaultValue={homes.length === 1 ? homes[0].id : ""} required>
            {homes.length > 1 && <option value="" disabled>Choose…</option>}
            {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
        </div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="rf">Resident first name</label><input id="rf" name="residentFirstName" maxLength={80} required /></div>
        <div className="field" style={{ flex: "1 1 160px" }}><label htmlFor="rl">Resident last name</label><input id="rl" name="residentLastName" maxLength={80} required /></div>
      </div>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "1 1 200px" }}><label htmlFor="pn">Power of attorney&apos;s name</label><input id="pn" name="poaName" maxLength={160} required /></div>
        <div className="field" style={{ flex: "1 1 220px" }}><label htmlFor="pe">Their email</label><input id="pe" name="poaEmail" type="email" maxLength={200} required /></div>
        <button className="btn primary" disabled={pending}>Send the link</button>
      </div>
      <Status state={state} />
    </form>
  );
}

/** Resend the link or cancel, with a confirmation for cancelling. */
export function PacketButtons({ resend, cancel }: { resend: () => Promise<FormState>; cancel: () => Promise<FormState> }) {
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
        <button type="button" className="btn small" disabled={busy} onClick={() => run(resend)}>Send a new link</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => confirm("Cancel this onboarding? The family's link stops working. Nothing is deleted.") && run(cancel)}>Cancel onboarding</button>
      </div>
      <Status state={state} />
    </div>
  );
}

/** One checklist item as staff see it: the family's answers, the home's fields and signatures, and review. */
export function StaffItem({
  packetId,
  item,
  open,
  me,
  consentText,
  save,
  sign,
  review,
}: {
  packetId: string;
  item: ItemView;
  open: boolean;
  me: string;
  consentText: string;
  save: (values: Values) => Promise<FormState>;
  sign: (blockId: string, s: { name: string; method: string; image?: string; consent: boolean }) => Promise<FormState>;
  review: (decision: "approve" | "changes", note: string) => Promise<FormState>;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(item.values);
  const [dirty, setDirty] = useState(false);
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const [signing, setSigning] = useState<Extract<Block, { type: "signature" }> | null>(null);
  const editable = open && item.status !== "approved";
  const signatures = Object.fromEntries(Object.entries(item.signatures).map(([k, s]) => [k, { name: s.name, image: s.image, signedAt: new Date(s.signedAt).toLocaleString() }]));
  const hasStaffPart = item.blocks.some((b) => (b.type === "field" || b.type === "signature") && b.who === "staff");

  async function doSave(): Promise<boolean> {
    if (!dirty) return true;
    const r = await save(values);
    setState(r);
    if (!r.error) setDirty(false);
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
          onChange={editable ? (id, v) => { setValues((x) => ({ ...x, [id]: v })); setDirty(true); } : undefined}
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
        <p className="small muted" style={{ margin: 0 }}>Tip: fill in the home&apos;s part before the family signs. Changing answers after someone signs clears the signatures.</p>
      )}
      <Status state={state} />
      {editable && (
        <div className="row" style={{ gap: 6 }}>
          {item.kind === "form" && hasStaffPart && <button type="button" className="btn small" disabled={busy || !dirty} onClick={async () => { setBusy(true); await doSave(); setBusy(false); }}>Save the home&apos;s answers</button>}
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            disabled={busy}
            onClick={async () => {
              const note = prompt("What needs changing? The family sees this note.");
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
