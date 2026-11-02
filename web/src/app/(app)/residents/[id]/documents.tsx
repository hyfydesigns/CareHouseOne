"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Icon } from "@/components/icon";
import { Status, type FormState } from "@/components/status";

const MAX_MB = 9;

/** Owners and admins: add a document to the resident's file by camera or from a file. */
export function DocumentUpload({ residentId, categories }: { residentId: string; categories: Array<[string, string]> }) {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<FormState>({});

  const pick = (list: FileList | null) => {
    const f = list?.[0] ?? null;
    if (f && f.size > MAX_MB * 1024 * 1024) return setState({ error: `${f.name} is too large. Use files under ${MAX_MB} MB, or scan fewer pages at a time.` });
    setState({});
    setFile(f);
  };

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file) return setState({ error: "Take a photo or choose a file first." });
    const fd = new FormData(e.currentTarget);
    const body = new FormData();
    body.append("file", file, file.name || "document.jpg");
    body.append("title", String(fd.get("title") ?? ""));
    body.append("category", String(fd.get("category") ?? ""));
    setBusy(true);
    const res = await fetch(`/api/residents/${residentId}/documents`, { method: "POST", body }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { message?: string; error?: string } | null;
    setBusy(false);
    if (!res?.ok) return setState({ error: json?.error ?? "Couldn't upload. Check the connection and try again." });
    setState({ message: json?.message ?? "Document added." });
    setFile(null);
    form.current?.reset();
    router.refresh();
  }

  return (
    <form ref={form} className="card" onSubmit={submit}>
      <h2>Add a document</h2>
      <div className="row" style={{ alignItems: "end" }}>
        <div className="field" style={{ flex: "2 1 220px" }}>
          <label htmlFor="docTitle">Name</label>
          <input id="docTitle" name="title" maxLength={120} placeholder="For example: Admission agreement" required />
        </div>
        <div className="field" style={{ flex: "1 1 200px" }}>
          <label htmlFor="docCat">Kind</label>
          <select id="docCat" name="category" defaultValue="" required>
            <option value="" disabled>Choose…</option>
            {categories.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>
      <div className="row">
        <label className="btn">
          <Icon name="camera" size={18} />Take a photo
          <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => pick(e.target.files)} />
        </label>
        <label className="btn">
          <Icon name="paperclip" size={18} />Choose a file
          <input type="file" accept="image/*,application/pdf" hidden onChange={(e) => pick(e.target.files)} />
        </label>
        {file && <span className="small"><b>{file.name || "Photo"}</b> · {(file.size / 1024 / 1024).toFixed(1)} MB</span>}
      </div>
      <p className="small muted" style={{ margin: 0 }}>Photos or PDFs, up to {MAX_MB} MB each. Photos are straightened and the camera&apos;s details (like location) are removed.</p>
      <Status state={state} />
      <div className="row"><button className="btn primary" disabled={busy || !file}>{busy ? "Uploading…" : "Add to file"}</button></div>
    </form>
  );
}

/** Takes a document off the file, after asking why. */
export function RemoveDocumentButton({ action, title }: { action: (reason: string) => Promise<FormState>; title: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  return (
    <span>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={async () => {
          const reason = prompt(`Why remove "${title}" from the file? For example: wrong resident, or uploaded twice.`);
          if (!reason) return;
          setBusy(true);
          const r = await action(reason);
          setBusy(false);
          setState(r);
          if (!r.error) router.refresh();
        }}
      >
        Remove
      </button>
      {state.error && <Status state={state} />}
    </span>
  );
}
