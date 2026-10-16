import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { getDb } from "@/db/client";
import { PENDING_COOKIE, readCookie } from "@/lib/session";
import { beginEnrollment } from "@/server/auth";
import { confirmSetupAction } from "../../actions";
import { CodeForm } from "../../forms";

export default async function SetupPage() {
  const token = await readCookie(PENDING_COOKIE);
  if (!token) redirect("/sign-in");
  const enr = await beginEnrollment(await getDb(), token);
  if (!enr) redirect("/sign-in");
  const qr = await QRCode.toDataURL(enr.uri, { margin: 1, width: 220 });
  const grouped = enr.secret.match(/.{1,4}/g)?.join(" ");
  return (
    <>
      <h1>Set up two-step verification</h1>
      <ol className="stack" style={{ paddingLeft: 20, margin: 0 }}>
        <li>Open an authenticator app on your phone (for example Google Authenticator or Microsoft Authenticator).</li>
        <li>Scan this code, or type the setup key.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for your authenticator app" width={220} height={220} style={{ justifySelf: "center", background: "#fff", padding: 6, borderRadius: 8 }} />
      <p className="small muted" style={{ textAlign: "center" }}>
        Setup key: <code>{grouped}</code>
      </p>
      <CodeForm action={confirmSetupAction} label="Finish setup" />
      <Link href="/sign-in">Cancel</Link>
    </>
  );
}
