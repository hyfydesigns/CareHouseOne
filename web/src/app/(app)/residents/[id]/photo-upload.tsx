"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { ResidentPhoto } from "@/components/resident-photo";

/** Big camera photos are shrunk on the device first, so uploads stay quick on home Wi-Fi. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file; // a format the browser can't read (the server still checks and converts it)
  }
}

/** Owners and admins: take or choose the resident's photo, or remove it. */
export function PhotoUpload({ residentId, photo, name }: { residentId: string; photo: string | null; name: string }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setMsg(null);
    const body = new FormData();
    body.append("photo", await shrink(file), "photo.jpg");
    const res = await fetch(`/api/residents/${residentId}/photo`, { method: "POST", body }).catch(() => null);
    const json = (await res?.json().catch(() => null)) as { message?: string; error?: string } | null;
    setBusy(false);
    if (res?.ok) {
      setMsg({ ok: true, text: json?.message ?? "Photo saved." });
      router.refresh();
    } else setMsg({ ok: false, text: json?.error ?? "Couldn't save the photo. Check the connection and try again." });
    if (input.current) input.current.value = "";
  }

  async function remove() {
    if (!confirm(`Remove ${name}'s photo?`)) return;
    setBusy(true);
    const res = await fetch(`/api/residents/${residentId}/photo`, { method: "DELETE" }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setMsg({ ok: true, text: "Photo removed." });
      router.refresh();
    } else setMsg({ ok: false, text: "Couldn't remove the photo. Try again." });
  }

  return (
    <section className="card" aria-labelledby="photo-h">
      <h2 id="photo-h">Photo</h2>
      <div className="row" style={{ gap: 16 }}>
        <ResidentPhoto src={photo} name={name} size={120} />
        <div className="stack" style={{ gap: 8, flex: "1 1 260px" }}>
          <p className="small muted" style={{ margin: 0 }}>
            Caregivers see this photo on the medication screens to check they have the right person. Use a recent, clear photo of the face, taken with the
            resident&apos;s (or guardian&apos;s) consent.
          </p>
          <div className="row">
            <label className="btn primary" style={{ display: "inline-flex", alignItems: "center", cursor: busy ? "progress" : "pointer" }}>
              {busy ? "Saving…" : photo ? "Replace photo" : "Add photo"}
              <input
                ref={input}
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                disabled={busy}
                onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
              />
            </label>
            {photo && (
              <button type="button" className="btn" onClick={remove} disabled={busy}>
                Remove photo
              </button>
            )}
          </div>
          {msg && (
            <p className={msg.ok ? "notice" : "error"} role={msg.ok ? "status" : "alert"} style={{ margin: 0 }}>
              {msg.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
