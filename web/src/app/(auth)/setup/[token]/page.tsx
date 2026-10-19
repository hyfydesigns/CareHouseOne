import Link from "next/link";
import { getDb } from "@/db/client";
import { siteUrl } from "@/lib/hosts";
import { describeSetup, signupOpen } from "@/server/billing";
import { CONTACT_EMAIL } from "../../../(site)/shell";
import { setupAction } from "./actions";
import { SetupForm } from "./setup-form";

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const info = signupOpen() ? await describeSetup(await getDb(), token) : null;
  if (!info) {
    return (
      <>
        <h1>This setup link doesn&apos;t work</h1>
        <p className="muted">It may have expired or already been used. If you already set up your organization, sign in. Otherwise check your email for the newest link, or contact us.</p>
        <Link href="/sign-in">Sign in</Link>
      </>
    );
  }
  return <SetupForm action={setupAction.bind(null, token)} payerEmail={info.payerEmail ?? ""} payerName={info.payerName ?? ""} site={siteUrl()} contact={CONTACT_EMAIL} />;
}
