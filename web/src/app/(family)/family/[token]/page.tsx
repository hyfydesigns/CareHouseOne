import { getDb, withTenant } from "@/db/client";
import { familyContext } from "@/lib/family-session";
import { E_SIGN_CONSENT, familyView } from "@/server/onboarding";
import { sendCodeAction, verifyCodeAction } from "./actions";
import { CodeGate, FamilyPortal } from "./portal";

export default async function FamilyPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ item?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  const { packet, signedIn } = await familyContext(token);
  if (!packet) {
    return (
      <div className="card">
        <h1>This link isn&apos;t working</h1>
        <p>It may have expired, or the home sent a newer link. Check your email for the latest one, or ask the home to send a new link.</p>
      </div>
    );
  }
  if (!signedIn) {
    return (
      <div className="card">
        <h1>Move-in paperwork for {packet.residentFirstName}</h1>
        <p>To keep {packet.residentFirstName}&apos;s information private, we&apos;ll email a 6-digit code to the address this link was sent to.</p>
        <CodeGate sendCode={sendCodeAction.bind(null, token)} verify={verifyCodeAction.bind(null, token)} />
      </div>
    );
  }
  const view = await withTenant(await getDb(), packet.orgId, (tx) => familyView(tx, packet));
  return <FamilyPortal token={token} view={view} openItem={sp.item ?? null} consentText={E_SIGN_CONSENT} />;
}
