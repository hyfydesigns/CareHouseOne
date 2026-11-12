"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SignDialog } from "@/components/sign-dialog";

/** The signer's title, then the usual draw-or-type signature dialog. */
export function SignContract({ sign, defaultName, consentText }: { sign: (input: { name: string; title: string; method: "drawn" | "typed"; image?: string; consent: boolean }) => Promise<string | null>; defaultName: string; consentText: string }) {
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="stack">
      <div className="field" style={{ maxWidth: 360 }}>
        <label htmlFor="title">Your title</label>
        <input id="title" value={title} maxLength={80} placeholder="Owner" onChange={(e) => setTitle(e.target.value)} />
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <button
        type="button"
        className="btn primary big"
        style={{ justifySelf: "start" }}
        onClick={() => {
          if (title.trim().length < 2) return setError("Enter your title, for example Owner.");
          setError(null);
          setOpen(true);
        }}
      >
        Sign the agreement
      </button>
      {open && (
        <SignDialog
          label="CareHouse One agreement"
          defaultName={defaultName}
          consentText={consentText}
          onClose={() => setOpen(false)}
          onSign={async (s) => {
            const err = await sign({ ...s, title: title.trim() });
            if (!err) router.refresh();
            return err;
          }}
        />
      )}
    </div>
  );
}
