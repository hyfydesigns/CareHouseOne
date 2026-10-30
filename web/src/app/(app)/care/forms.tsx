"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useOfflineSubmit } from "@/components/offline";
import { Icon } from "@/components/icon";
import { Status, type FormState } from "@/components/status";

type Action = (s: FormState, fd: FormData) => Promise<FormState>;

export function VitalsForm({ action, residentId, lastReading }: { action: Action; residentId: string; lastReading?: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const offline = useOfflineSubmit("vitals");
  const field = (id: string, label: string, mode: "numeric" | "decimal" = "numeric") => (
    <div className="field" style={{ flex: "1 1 140px" }}>
      <label htmlFor={id}>{label}</label>
      <input id={id} name={id} inputMode={mode} autoComplete="off" />
    </div>
  );
  return (
    <form action={formAction} onSubmit={offline.onSubmit} className="card">
      <h2>Record vital signs</h2>
      {lastReading && <p className="small muted" style={{ margin: 0 }}>Last reading: {lastReading}</p>}
      <input type="hidden" name="residentId" value={residentId} />
      <div className="row" style={{ alignItems: "start" }}>
        {field("systolic", "BP top number")}
        {field("diastolic", "BP bottom number")}
        {field("pulse", "Pulse")}
        {field("temperature", "Temperature °F", "decimal")}
      </div>
      <fieldset className="row" style={{ border: 0, padding: 0, margin: 0, gap: 10 }}>
        <legend className="small" style={{ fontWeight: 700, marginBottom: 6 }}>Blood pressure taken</legend>
        <label className="chip" style={{ minHeight: 48, gap: 8, cursor: "pointer" }}>
          <input type="radio" name="bpPosition" value="sitting" defaultChecked /> Sitting
        </label>
        <label className="chip" style={{ minHeight: 48, gap: 8, cursor: "pointer" }}>
          <input type="radio" name="bpPosition" value="lying" /> Lying down
        </label>
      </fieldset>
      <div className="row" style={{ alignItems: "start" }}>
        {field("bloodSugar", "Blood sugar mg/dL")}
        {field("oxygen", "Oxygen %")}
        {field("weight", "Weight lb", "decimal")}
        <div className="field" style={{ flex: "2 1 220px" }}><label htmlFor="vnote">Note (optional)</label><input id="vnote" name="note" /></div>
      </div>
      <p className="small muted" style={{ margin: 0 }}>Blood pressure and pulse are required. Readings outside the usual range are flagged for review; tell the nurse right away.</p>
      <Status state={offline.saved ? { message: offline.saved } : state} />
      <div className="row"><button className="btn primary big" disabled={pending}><Icon name="pulse" size={20} />Save vital signs</button></div>
    </form>
  );
}

const CATEGORIES: Array<[string, string]> = [["general", "General"], ["activity", "Activity"], ["health", "Health"], ["behavior", "Behavior"], ["family_contact", "Family contact"]];

/** Up to this many photos or files per note, each under 9 MB (checked again on the server). */
const MAX_FILES = 6;
const MAX_FILE_MB = 9;

type Picked = { file: File; preview: string | null };

export function NoteForm({ action, residentId, shift, firstName }: { action: Action; residentId: string; shift: string; firstName: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const offline = useOfflineSubmit("note");
  const [files, setFiles] = useState<Picked[]>([]);
  const [upload, setUpload] = useState<{ busy: boolean; message?: string; error?: string }>({ busy: false });
  const uploadedFor = useRef<string | null>(null);
  const router = useRouter();

  const add = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].slice(0, MAX_FILES - files.length);
    const tooBig = picked.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
    if (tooBig) return setUpload({ busy: false, error: `${tooBig.name} is too large. Use files under ${MAX_FILE_MB} MB.` });
    setUpload({ busy: false });
    setFiles((cur) => [...cur, ...picked.map((file) => ({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null }))]);
  };
  const remove = (i: number) =>
    setFiles((cur) => {
      const gone = cur[i];
      if (gone?.preview) URL.revokeObjectURL(gone.preview);
      return cur.filter((_, k) => k !== i);
    });

  // Once the note is saved, send each photo or file to it, one request each.
  useEffect(() => {
    const noteId = state.id;
    if (!noteId || uploadedFor.current === noteId || !files.length) return;
    uploadedFor.current = noteId;
    const queue = files;
    (async () => {
      setUpload({ busy: true, message: `Attaching ${queue.length} file${queue.length === 1 ? "" : "s"}…` });
      const failed: string[] = [];
      for (const { file } of queue) {
        const body = new FormData();
        body.append("file", file, file.name || "photo.jpg");
        const res = await fetch(`/api/notes/${noteId}/attachments`, { method: "POST", body }).catch(() => null);
        if (!res?.ok) failed.push((await res?.json().catch(() => null))?.error ?? `${file.name} didn't upload.`);
      }
      queue.forEach((f) => f.preview && URL.revokeObjectURL(f.preview));
      setFiles([]);
      setUpload(failed.length ? { busy: false, error: `Note saved, but: ${failed.join(" ")}` } : { busy: false, message: `Note saved with ${queue.length} attachment${queue.length === 1 ? "" : "s"}.` });
      // The note list was drawn when the note saved, before its files arrived.
      router.refresh();
    })();
  }, [state.id, files, router]);

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    if (files.length && !navigator.onLine) {
      e.preventDefault();
      setUpload({ busy: false, error: "Photos and files need a connection. Save the note without them now, and attach them when you're back online." });
      return;
    }
    offline.onSubmit(e);
  };

  const status = offline.saved ? { message: offline.saved } : upload.error ? { error: upload.error } : upload.message ? { message: upload.message } : state;
  return (
    <form action={formAction} onSubmit={onSubmit} className="card">
      <h2>New progress note</h2>
      <input type="hidden" name="residentId" value={residentId} />
      <div className="row" style={{ alignItems: "start" }}>
        <div className="field" style={{ flex: "1 1 160px" }}>
          <label htmlFor="shift">Shift</label>
          <select id="shift" name="shift" defaultValue={shift}><option value="day">Day</option><option value="evening">Evening</option><option value="night">Night</option></select>
        </div>
        <div className="field" style={{ flex: "1 1 180px" }}>
          <label htmlFor="category">Type</label>
          <select id="category" name="category">{CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="body">Note</label>
        <textarea id="body" name="body" rows={4} required placeholder={`Write facts: what you saw, what you did, and how ${firstName} responded.`} />
      </div>
      <div className="stack" style={{ gap: 8 }}>
        <span className="small" style={{ fontWeight: 700 }}>Photos and documents (optional)</span>
        <div className="row" style={{ gap: 8 }}>
          {/* The file inputs have no name: files go to the note after it's saved, not with the form. */}
          <label className={`btn${files.length >= MAX_FILES ? " disabled" : ""}`}>
            <Icon name="camera" size={20} />Take a photo
            <input type="file" accept="image/*" capture="environment" hidden disabled={files.length >= MAX_FILES} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </label>
          <label className={`btn${files.length >= MAX_FILES ? " disabled" : ""}`}>
            <Icon name="paperclip" size={20} />Add a file
            <input type="file" accept="image/*,application/pdf" multiple hidden disabled={files.length >= MAX_FILES} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
          </label>
          <span className="small muted">Scan a paper form, a doctor&apos;s note or a wound with the camera. Up to {MAX_FILES}, under {MAX_FILE_MB} MB each.</span>
        </div>
        {files.length > 0 && (
          <ul className="attach-list">
            {files.map((f, i) => (
              <li key={`${f.file.name}-${i}`} className="attach-chip">
                {/* eslint-disable-next-line @next/next/no-img-element -- a local preview of a file not uploaded yet */}
                {f.preview ? <img src={f.preview} alt="" /> : <span className="attach-pdf" aria-hidden="true">PDF</span>}
                <span className="small">{f.file.name || "Photo"}</span>
                <button type="button" className="linkbtn small" onClick={() => remove(i)} aria-label={`Remove ${f.file.name || "photo"}`}>Remove</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Status state={status} />
      <div className="row"><button className="btn primary big" disabled={pending || upload.busy}><Icon name="notes" size={20} />{upload.busy ? "Attaching…" : "Save note"}</button></div>
    </form>
  );
}

export function AddendumButton({ action, residentId, noteId, shift, category }: { action: Action; residentId: string; noteId: string; shift: string; category: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="linkbtn small" onClick={() => setOpen(true)}>Add an addendum</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="addendumTo" value={noteId} />
      <input type="hidden" name="shift" value={shift} />
      <input type="hidden" name="category" value={category} />
      <label className="small" htmlFor={`add-${noteId}`}>Addendum (notes can&apos;t be edited; add the correction here)</label>
      <textarea id={`add-${noteId}`} name="body" rows={2} required />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Save addendum</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function ReviewButton({ action, vitalId, residentId }: { action: Action; vitalId: string; residentId: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  if (state.message) return <span className="pill ok">Reviewed</span>;
  return (
    <form action={formAction} className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
      <input type="hidden" name="vitalId" value={vitalId} />
      <input type="hidden" name="residentId" value={residentId} />
      <input name="note" placeholder="Follow-up (optional)" aria-label="Follow-up note" style={{ minWidth: 160 }} />
      <button className="btn small" disabled={pending}>Mark reviewed</button>
      <Status state={state} />
    </form>
  );
}

export function AddDiagnosisButton({ action, residentId, code, description }: { action: Action; residentId: string; code: string; description: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Select</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 260 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="code" value={code} />
      <label className="small" htmlFor={`lbl-${code}`}>Plain-language name for caregivers</label>
      <input id={`lbl-${code}`} name="label" defaultValue={description} />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small primary" disabled={pending}>Add diagnosis</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}

export function RemoveDiagnosisButton({ action, residentId, diagnosisId, code }: { action: Action; residentId: string; diagnosisId: string; code: string }) {
  const [state, formAction, pending] = useActionState(action, {});
  const [open, setOpen] = useState(false);
  if (state.message) return <Status state={state} />;
  if (!open) return <button className="btn small" onClick={() => setOpen(true)}>Remove</button>;
  return (
    <form action={formAction} className="stack" style={{ gap: 6, minWidth: 220 }}>
      <input type="hidden" name="residentId" value={residentId} />
      <input type="hidden" name="diagnosisId" value={diagnosisId} />
      <label className="small" htmlFor={`rm-${diagnosisId}`}>Why is {code} being removed?</label>
      <input id={`rm-${diagnosisId}`} name="reason" placeholder="Resolved, or entered in error" />
      <Status state={state} />
      <div className="row" style={{ gap: 6 }}>
        <button className="btn small danger" disabled={pending}>Remove</button>
        <button type="button" className="btn small" onClick={() => setOpen(false)}>Keep</button>
      </div>
    </form>
  );
}

/** `homes`: the tablet's homes this person can start a shift at (null when not on a registered tablet). */
export function ShiftButton({ action, signedIn, homes }: { action: Action; signedIn: boolean; homes: Array<{ id: string; name: string }> | null }) {
  const [state, formAction, pending] = useActionState(action, {});
  const blocked = !signedIn && !homes?.length;
  return (
    <form action={formAction} className="stack">
      <input type="hidden" name="op" value={signedIn ? "out" : "in"} />
      <div className="row">
        {signedIn || blocked ? (
          <button className={`btn big ${signedIn ? "" : "primary"}`} disabled={pending || blocked} style={{ minWidth: 220 }}><Icon name={signedIn ? "logout" : "clock"} size={20} />{signedIn ? "End shift" : "Start shift"}</button>
        ) : (
          homes!.map((h) => (
            <button key={h.id} className="btn big primary" name="facilityId" value={h.id} disabled={pending} style={{ minWidth: 220 }}><Icon name="clock" size={20} />Start shift at {h.name}</button>
          ))
        )}
      </div>
      {!signedIn && (homes?.length ?? 0) > 1 && <p className="small muted" style={{ margin: 0 }}>Choose the home you&apos;re working at today; your hours are recorded there.</p>}
      {blocked && (
        <p className="small muted" style={{ margin: 0 }}>
          {homes ? "This tablet isn't used at any of your homes. Ask your manager." : "Shifts are started on the home's registered tablet, so your hours are recorded at the right home."}
        </p>
      )}
      <Status state={state} />
    </form>
  );
}
