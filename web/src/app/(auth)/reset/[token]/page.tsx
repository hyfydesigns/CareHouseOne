import Link from "next/link";
import { getDb } from "@/db/client";
import { describeToken } from "@/server/auth";
import { resetAction } from "../../actions";
import { NewPasswordForm } from "../../forms";

export default async function ResetPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await describeToken(await getDb(), token, ["reset"]);
  if (!info) {
    return (
      <>
        <h1>This link has expired</h1>
        <p className="muted">Reset links work once and expire after 30 minutes.</p>
        <Link href="/forgot">Ask for a new link</Link>
      </>
    );
  }
  return (
    <>
      <h1>Choose a new password</h1>
      <p className="muted">For {info.email}</p>
      <NewPasswordForm action={resetAction.bind(null, token)} submit="Save password" />
    </>
  );
}
