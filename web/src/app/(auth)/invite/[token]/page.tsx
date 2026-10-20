import { getDb } from "@/db/client";
import { usesTwoStep } from "@/lib/permissions";
import { describeToken } from "@/server/auth";
import { acceptInviteAction, forgotAction } from "../../actions";
import { EmailForm, NewPasswordForm } from "../../forms";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = await describeToken(await getDb(), token, ["invite", "reactivate"]);
  if (!info) {
    return (
      <>
        <h1>This invitation has expired</h1>
        <p className="muted">Invitations expire after 7 days or when a newer one is sent. Enter your email and we&apos;ll send you a new link.</p>
        <EmailForm action={forgotAction} submit="Send me a new link" />
      </>
    );
  }
  return (
    <>
      <h1>{info.purpose === "invite" ? `Welcome, ${info.name.split(" ")[0]}` : `Welcome back, ${info.name.split(" ")[0]}`}</h1>
      <p className="muted">
        Set a password for {info.email}.{" "}
        {usesTwoStep(info.role)
          ? "Next you'll set up two-step verification."
          : "You'll use it to sign in on your home's CareHouse One tablet, where you'll also choose a PIN."}
      </p>
      <NewPasswordForm action={acceptInviteAction.bind(null, token)} submit="Set password" />
    </>
  );
}
