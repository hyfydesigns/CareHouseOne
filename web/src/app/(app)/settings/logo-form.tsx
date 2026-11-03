"use client";
/* eslint-disable @next/next/no-img-element -- the logo is a data: URL from the server */

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Status, type FormState } from "@/components/status";

/** The organization's logo: shown in the header of every form, on screen and in signed PDFs. */
export function LogoForm({ logo, orgName }: { logo: string | null; orgName: string }) {
  const router = useRouter();
  const [state, setState] = useState<FormState>({});
  const [busy, setBusy] = useState(false);
  const send = async (init: RequestInit) => {
    setBusy(true);
    const res = await fetch("/api/org/logo", init).catch(() => null);
    const json = (await res?.json().catch(() => null)) as FormState | null;
    setBusy(false);
    setState(res?.ok ? { message: json?.message } : { error: json?.error ?? "Couldn't save. Check the connection and try again." });
    if (res?.ok) router.refresh();
  };
  return (
    <section className="card" aria-labelledby="logo-h">
      <h2 id="logo-h">Logo</h2>
      <p className="small muted" style={{ margin: 0 }}>Shown with the home&apos;s address at the top of every onboarding form and signed PDF. A PNG with a transparent or white background works best.</p>
      <div className="row" style={{ alignItems: "center" }}>
        {logo ? <img src={logo} alt={`${orgName} logo`} className="org-logo" /> : <span className="muted">No logo yet.</span>}
        <span className="spacer" />
        <label className="btn">
          {logo ? "Replace logo" : "Upload a logo"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const body = new FormData();
              body.append("logo", f);
              send({ method: "POST", body });
              e.target.value = "";
            }}
          />
        </label>
        {logo && <button type="button" className="btn" disabled={busy} onClick={() => confirm("Remove the logo from your forms?") && send({ method: "DELETE" })}>Remove</button>}
      </div>
      <Status state={state} />
    </section>
  );
}
