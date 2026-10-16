import Link from "next/link";
import { redirect } from "next/navigation";
import { PENDING_COOKIE, readCookie } from "@/lib/session";
import { verifyAction } from "../../actions";
import { CodeForm } from "../../forms";

export default async function VerifyPage() {
  if (!(await readCookie(PENDING_COOKIE))) redirect("/sign-in");
  return (
    <>
      <h1>Two-step verification</h1>
      <p className="muted">Enter the 6-digit code from your authenticator app. Two-step verification is required for every account.</p>
      <CodeForm action={verifyAction} label="Verify" />
      <Link href="/sign-in">Back to sign in</Link>
    </>
  );
}
