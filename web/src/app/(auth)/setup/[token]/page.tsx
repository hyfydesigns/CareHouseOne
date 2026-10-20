import Link from "next/link";
import { getDb } from "@/db/client";
import { siteUrl } from "@/lib/hosts";
import { describeSetup, signupOpen } from "@/server/billing";
import { CONTACT_EMAIL } from "../../../(site)/shell";
import { EmailForm } from "../../forms";
import { resendSetupAction, setupAction } from "./actions";
import { SetupForm } from "./setup-form";

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = signupOpen() ? await describeSetup(await getDb(), token) : null;
  if (!info) {
    return (
      <>
        <h1>This setup link doesn&apos;t work</h1>
        <p className="muted">It may have expired or already been used. If you already set up your organization, <Link href="/sign-in">sign in</Link>.</p>
        <p className="muted">Paid but didn&apos;t finish setting up? Enter the email on your PayPal account for a new link.</p>
        <EmailForm action={resendSetupAction} submit="Send me a new setup link" label="Email on your PayPal account" />
      </>
    );
  }
  return <SetupForm action={setupAction.bind(null, token)} payerEmail={info.payerEmail ?? ""} payerName={info.payerName ?? ""} site={siteUrl()} contact={CONTACT_EMAIL} />;
}
