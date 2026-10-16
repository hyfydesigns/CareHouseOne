import Link from "next/link";
import { signInAction } from "../actions";
import { SignInForm } from "../forms";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  return (
    <>
      <h1>Sign in</h1>
      {reset && <p className="notice" role="status">Password changed. You&apos;ve been signed out on all other devices.</p>}
      <SignInForm action={signInAction} />
      <Link href="/forgot">Forgot password?</Link>
      <p className="muted small">This system contains protected health information. All access is logged.</p>
    </>
  );
}
