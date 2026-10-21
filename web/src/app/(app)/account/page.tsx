import Link from "next/link";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import { ROLE_LABEL } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { beginEnrollment } from "@/server/auth";
import { disableTwoStepAction, enableTwoStepAction } from "../../(auth)/actions";
import { CodeForm } from "../../(auth)/forms";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const db = await getDb();
  const [u] = await db.select({ mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, me.id));
  const setup = !u.mfaEnabled && !me.device && sp.setup === "1" ? await beginEnrollment(db, me.id) : null;
  const qr = setup ? await QRCode.toDataURL(setup.uri, { margin: 1, width: 220 }) : null;
  return (
    <>
      <div>
        <h1>Account</h1>
        <p className="muted">{me.name} · {me.email} · {ROLE_LABEL[me.role]}</p>
      </div>
      <section className="card" aria-labelledby="mfa-h">
        <div className="row">
          <h2 id="mfa-h" style={{ margin: 0 }}>Two-step verification</h2>
          <span className={`pill ${u.mfaEnabled ? "ok" : "mute"}`}>{u.mfaEnabled ? "On" : "Off"}</span>
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Optional. When it&apos;s on, signing in also asks for a 6-digit code from an authenticator app on your phone, so a stolen password alone can&apos;t open
          residents&apos; records. Recommended for owners and admins.
        </p>
        {me.device ? (
          <p className="notice" style={{ margin: 0 }}>Set this up from your own phone or computer, not the home&apos;s shared tablet.</p>
        ) : u.mfaEnabled ? (
          <div className="stack" style={{ maxWidth: 360 }}>
            <p className="small" style={{ margin: 0 }}>To turn it off, enter the current code from your authenticator app.</p>
            <CodeForm action={disableTwoStepAction} label="Turn off two-step verification" />
          </div>
        ) : setup && qr ? (
          <div className="stack" style={{ maxWidth: 420 }}>
            <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
              <li>Open an authenticator app on your phone (for example Google Authenticator or Microsoft Authenticator).</li>
              <li>Scan this code, or type the setup key.</li>
              <li>Enter the 6-digit code the app shows.</li>
            </ol>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code for your authenticator app" width={220} height={220} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />
            <p className="small muted" style={{ margin: 0 }}>
              Setup key: <code>{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            </p>
            <CodeForm action={enableTwoStepAction} label="Turn on two-step verification" />
            <Link href="/account">Cancel</Link>
          </div>
        ) : (
          <Link className="btn primary" href="/account?setup=1" style={{ justifySelf: "start" }}>Turn on two-step verification</Link>
        )}
      </section>
    </>
  );
}
