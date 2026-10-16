import Link from "next/link";
import { currentDevice } from "@/lib/session";
import { signInAction } from "../actions";
import { SignInForm } from "../forms";

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ reset?: string; locked?: string }> }) {
  const { reset, locked } = await searchParams;
  const device = await currentDevice();
  return (
    <>
      <h1>Sign in</h1>
      {device && <p className="pill ok" style={{ alignSelf: "start" }}>Registered tablet · {device.name}</p>}
      {reset && <p className="notice" role="status">Password changed. You&apos;ve been signed out on all other devices.</p>}
      {locked && <p className="notice" role="status">You were signed out of the tablet. Sign in with your password to continue.</p>}
      <SignInForm action={signInAction} />
      <Link href="/forgot">Forgot password?</Link>
      <p className="muted small">This system contains protected health information. All access is logged.</p>
    </>
  );
}
