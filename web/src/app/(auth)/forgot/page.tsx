import Link from "next/link";
import { forgotAction } from "../actions";
import { EmailForm } from "../forms";

export default function ForgotPage() {
  return (
    <>
      <h1>Reset your password</h1>
      <p className="muted">We&apos;ll email you a single-use link that expires in 30 minutes. Your manager can also send you one.</p>
      <EmailForm action={forgotAction} />
      <Link href="/sign-in">Back to sign in</Link>
    </>
  );
}
