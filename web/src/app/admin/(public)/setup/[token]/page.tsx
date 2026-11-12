import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { describeAdminSetup } from "@/server/admin-auth";
import { adminSetupAction } from "../../../actions";
import { SetupForm } from "../../../forms";

export default async function AdminSetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const setup = await describeAdminSetup(await getDb(), token);
  if (!setup) {
    return (
      <>
        <h1>Link expired</h1>
        <p>This setup link has expired or was already used. Run <code>npm run admin:create</code> again for a new one.</p>
      </>
    );
  }
  const qr = await QRCode.toDataURL(setup.uri, { margin: 1, width: 220 });
  return (
    <>
      <h1>Set up your admin account</h1>
      <p className="muted" style={{ margin: 0 }}>{setup.name} · {setup.email}</p>
      <ol className="small" style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>
        <li>Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
        <li>Choose a password and enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} style={{ background: "#fff", padding: 6, borderRadius: 8, justifySelf: "center" }} />
      <details className="small">
        <summary>Can&apos;t scan? Enter the key by hand</summary>
        <code style={{ wordBreak: "break-all" }}>{setup.secret}</code>
      </details>
      <SetupForm action={adminSetupAction.bind(null, token)} />
    </>
  );
}
