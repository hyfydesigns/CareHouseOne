import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { demoMode } from "@/server/demo";
import { demoFamilyLink, E_SIGN_CONSENT, getOnboarding, ITEM_STATUS, suggestResident } from "@/server/onboarding";
import { canManageOnboarding } from "@/server/onboarding-forms";
import { admitAction, cancelOnboardingAction, resendLinkAction, reviewAction, staffSaveAction, staffSignAction } from "../actions";
import { AdmitForm, PacketButtons, StaffItem } from "../staff-forms";

const TONE = { todo: "", submitted: "warn", changes: "info", approved: "ok" } as const;

export default async function OnboardingDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const { id } = await params;
  const o = await withTenant(await getDb(), me.orgId, async (tx) => {
    const found = await getOnboarding(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, id);
    return found && { ...found, demoLink: demoMode() ? await demoFamilyLink(tx, found.p) : null };
  });
  if (!o) notFound();
  const { p, home, items } = o;
  const open = p.status === "open";
  const waiting = items.filter((i) => i.required && i.status !== "approved");
  return (
    <>
      <div className="card">
        <Link href="/onboarding" className="small">‹ Onboarding</Link>
        <div className="row" style={{ alignItems: "start" }}>
          <div>
            <h1>{p.residentFirstName} {p.residentLastName}</h1>
            <p className="muted" style={{ margin: 0 }}>{home.name} · Power of attorney: {p.poaName} ({p.poaEmail})</p>
            <p className="small muted" style={{ margin: 0 }}>
              {p.status === "open" && `Link works until ${p.expiresAt.toISOString().slice(0, 10)}.`}
              {p.status === "admitted" && <>Admitted {p.admittedAt?.toISOString().slice(0, 10)}. <Link href={`/residents/${p.residentId}?tab=documents`}>Open the resident&apos;s documents</Link></>}
              {p.status === "cancelled" && `Cancelled ${p.cancelledAt?.toISOString().slice(0, 10)}.`}
            </p>
          </div>
          <span className="spacer" />
          {o.demoLink && <a className="btn small" href={o.demoLink} target="_blank" rel="noreferrer">Demo: open the family&apos;s page</a>}
          {open && <PacketButtons resend={resendLinkAction.bind(null, p.id)} cancel={cancelOnboardingAction.bind(null, p.id)} />}
        </div>
      </div>

      {items.map((i) => (
        <details key={i.id} className="card" open={open && i.status === "submitted"}>
          <summary className="row" style={{ cursor: "pointer" }}>
            <b>{i.title}</b>{!i.required && <span className="small muted">optional</span>}
            <span className="spacer" />
            <span className={`pill ${TONE[i.status]}`}>{i.status === "submitted" ? "Ready for review" : ITEM_STATUS[i.status]}</span>
          </summary>
          {i.status === "changes" && i.staffNote && <p className="small"><b>Asked the family:</b> {i.staffNote}</p>}
          {open && i.status !== "approved" && (i.poaMissing.length > 0 || i.staffMissing.length > 0) && (
            <p className="small muted" style={{ margin: 0 }}>
              {i.poaMissing.length > 0 && <>Family still to do: {i.poaMissing.slice(0, 4).join(", ")}{i.poaMissing.length > 4 ? "…" : ""}. </>}
              {i.staffMissing.length > 0 && <>Home still to do: {i.staffMissing.join(", ")}.</>}
            </p>
          )}
          <StaffItem
            packetId={p.id}
            item={i}
            open={open}
            me={me.name}
            consentText={E_SIGN_CONSENT}
            save={staffSaveAction.bind(null, p.id, i.id)}
            sign={staffSignAction.bind(null, p.id, i.id)}
            review={reviewAction.bind(null, p.id, i.id)}
          />
        </details>
      ))}

      {open && (waiting.length ? (
        <p className="muted">Approve every required item to admit {p.residentFirstName}. Still waiting on: {waiting.map((i) => i.title).join(", ")}.</p>
      ) : (
        <AdmitForm action={admitAction.bind(null, p.id)} suggested={suggestResident(p, items)} />
      ))}
    </>
  );
}
