import { getDb } from "@/db/client";
import { describeToken } from "@/server/auth";
import { acceptInviteAction } from "../../actions";
import { NewPasswordForm } from "../../forms";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await describeToken(await getDb(), token, ["invite", "reactivate"]);
  if (!info) {
    return (
      <>
        <h1>This invitation has expired</h1>
        <p className="muted">Invitations expire after 7 days or when a new one is sent. Ask your manager to send a new one.</p>
      </>
    );
  }
  return (
    <>
      <h1>{info.purpose === "invite" ? `Welcome, ${info.name.split(" ")[0]}` : `Welcome back, ${info.name.split(" ")[0]}`}</h1>
      <p className="muted">Set a password for {info.email}. Next you&apos;ll set up two-step verification.</p>
      <NewPasswordForm action={acceptInviteAction.bind(null, token)} submit="Set password" />
    </>
  );
}
