import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { asAudience } from "@/lib/onboarding-forms";
import { requireUser } from "@/lib/session";
import { listOnboardings } from "@/server/onboarding";
import { canManageOnboarding, ensureStarterForms, listForms } from "@/server/onboarding-forms";
import { visibleFacilities } from "@/server/residents";
import { startOnboardingAction } from "./actions";
import { StartOnboardingForm } from "./staff-forms";

const STATUS: Record<string, [string, string]> = { draft: ["Not sent yet", "warn"], open: ["In progress", "info"], admitted: ["Admitted", "ok"], hired: ["Hired", "ok"], cancelled: ["Cancelled", "mute"] };

/** Move-ins and new hires: send the paperwork, check it, and admit or hire. */
export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ for?: string }> }) {
  const audience = asAudience((await searchParams).for);
  const staff = audience === "staff";
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    await ensureStarterForms(tx, me.orgId, me.id, audience);
    return { list: await listOnboardings(tx, actor, audience), homes: await visibleFacilities(tx, actor), forms: await listForms(tx, actor, { audience }) };
  });
  return (
    <>
      <div className="row">
        <div>
          <h1>Onboarding</h1>
          <p className="muted" style={{ margin: 0 }}>{staff ? "Send a new hire their paperwork, check and countersign it, then hire them." : <>Send a new resident&apos;s responsible party the move-in paperwork, check and countersign it, then admit.</>}</p>
        </div>
        <span className="spacer" />
        <Link className="btn" href={`/onboarding/forms${staff ? "?for=staff" : ""}`}>Manage forms</Link>
      </div>
      <div className="chips">
        <Link className="chip" href="/onboarding" aria-current={staff ? undefined : "page"}>Residents</Link>
        <Link className="chip" href="/onboarding?for=staff" aria-current={staff ? "page" : undefined}>Staff</Link>
      </div>
      <StartOnboardingForm action={startOnboardingAction} homes={data.homes.map((h) => ({ id: h.id, name: h.name }))} forms={data.forms.map((f) => ({ id: f.id, title: f.title, required: f.required, afterHire: f.afterHire }))} audience={audience} />
      <section className="card" aria-labelledby="ob-h">
        <h2 id="ob-h">Onboardings</h2>
        <div className="tablewrap">
          <table className="fit-sm">
            <thead><tr><th>{staff ? "New hire" : "Resident"}</th><th className="hide-sm">{staff ? "Email" : "Responsible party"}</th><th>Progress</th><th></th></tr></thead>
            <tbody>
              {data.list.length ? data.list.map(({ p, home, total, optional, approved, submitted, changes }) => (
                <tr key={p.id}>
                  <td><Link href={`/onboarding/${p.id}`}><b>{p.residentFirstName} {p.residentLastName}</b></Link><div className="small muted">{home} · started {p.createdAt.toISOString().slice(0, 10)}</div></td>
                  <td className="hide-sm">{!staff && p.poaName}<div className="small muted">{p.poaEmail}</div></td>
                  <td>
                    {p.status === "open" || p.status === "draft" || p.status === "hired" ? (
                      <span className="small">
                        {approved}/{total} approved{optional ? ` (${optional} optional)` : ""}{submitted ? ` · ${submitted} to review` : ""}{changes ? ` · ${changes} sent back` : ""}
                      </span>
                    ) : null}
                  </td>
                  <td style={{ textAlign: "right" }}><span className={`pill ${STATUS[p.status]?.[1] ?? ""}`}>{STATUS[p.status]?.[0] ?? p.status}</span>{submitted > 0 && p.status === "open" && <span className="pill warn" style={{ marginLeft: 6 }}>Needs review</span>}</td>
                </tr>
              )) : <tr><td colSpan={4} className="muted">No onboardings yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
