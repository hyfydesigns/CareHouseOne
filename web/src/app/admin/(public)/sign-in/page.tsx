import { SignInForm } from "../../../(auth)/forms";
import { adminSignInAction } from "../../actions";

export default async function AdminSignInPage({ searchParams }: { searchParams: Promise<{ setup?: string }> }) {
  const { setup } = await searchParams;
  return (
    <>
      <h1>Admin sign-in</h1>
      {setup && <p className="notice" role="status">You&apos;re set up. Sign in with your password and a code from your authenticator app.</p>}
      <SignInForm action={adminSignInAction} />
      <p className="muted small">For CareHouse One staff only. Every sign-in and change is recorded.</p>
    </>
  );
}
