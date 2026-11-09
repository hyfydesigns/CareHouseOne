import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { facilities, roleEnum } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { demoMode } from "@/server/demo";
import { FormLetterhead } from "@/components/form-letterhead";
import { demoFamilyLink, E_SIGN_CONSENT, getOnboarding, ITEM_STATUS, letterheadView, suggestResident } from "@/server/onboarding";
import { asAudience, missingFor } from "@/lib/onboarding-forms";
import { canInvite, ROLE_LABEL } from "@/lib/permissions";
import { canManageOnboarding } from "@/server/onboarding-forms";
import { admitAction, cancelOnboardingAction, hireAction, paperUndoAction, resendLinkAction, reviewAction, sendOnboardingAction, staffSaveAction, staffSignAction } from "../actions";
import { AdmitForm, HireForm, PacketButtons, StaffItem } from "../staff-forms";

const TONE = { todo: "", submitted: "warn", changes: "info", approved: "ok" } as const;

export default async function OnboardingDetail({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const { id } = await params;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const o = await withTenant(await getDb(), me.orgId, async (tx) => {
    const found = await getOnboarding(tx, actor, id);
    return found && { ...found, demoLink: demoMode() ? await demoFamilyLink(tx, found.p) : null, allHomes: await tx.select({ id: facilities.id, name: facilities.name }).from(facilities).orderBy(facilities.name) };
  });
  if (!o) notFound();
  const { p, home, items } = o;
  const audience = asAudience(p.audience);
  const staff = audience === "staff";
  const person = staff ? "the employee" : "the family";
  const open = p.status === "open";
  const draft = p.status === "draft";
  const hired = p.status === "hired";
  const myHomes = o.allHomes.filter((h) => canInvite(actor, "caregiver", [h.id]));
  const roles = roleEnum.enumValues.filter((r) => myHomes.some((h) => canInvite(actor, r, [h.id]))).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  // The home's answers (not its signatures, which come after the family's part).
  const homeFields = (i: (typeof items)[number]) => i.paper ? [] : missingFor(i.blocks.filter((b) => b.type === "field"), i.values, new Set(), "staff");
  const homeToDo = items.filter((i) => homeFields(i).length);
  const sendWarning = homeToDo.length
    ? `The home's part isn't filled in yet on: ${homeToDo.map((i) => i.title).join(", ")}. Send the link to ${p.poaEmail} anyway?`
    : `Send the link to ${p.poaEmail} now?`;
  const waiting = items.filter((i) => i.required && !i.afterHire && i.status !== "approved");
  return (
    <>
      <div className="card">
        <Link href={`/onboarding${staff ? "?for=staff" : ""}`} className="small">‹ Onboarding</Link>
        <FormLetterhead head={letterheadView(o.head)} />
        <div className="row" style={{ alignItems: "start" }}>
          <div>
            <h1>{p.residentFirstName} {p.residentLastName}</h1>
            <p className="muted" style={{ margin: 0 }}>{home.name} · {staff ? p.poaEmail : <>Responsible party: {p.poaName} ({p.poaEmail})</>}</p>
            <p className="small muted" style={{ margin: 0 }}>
              {draft && "Not sent yet. Fill in the home's part below, then send the link."}
              {p.status === "open" && `Link works until ${p.expiresAt.toISOString().slice(0, 10)}.`}
              {hired && <>Hired {p.admittedAt?.toISOString().slice(0, 10)}. Link works until {p.expiresAt.toISOString().slice(0, 10)}. <Link href={`/staff/${p.staffUserId}`}>Open their documents</Link></>}
              {p.status === "admitted" && <>Admitted {p.admittedAt?.toISOString().slice(0, 10)}. <Link href={`/residents/${p.residentId}?tab=documents`}>Open the resident&apos;s documents</Link></>}
              {p.status === "cancelled" && `Cancelled ${p.cancelledAt?.toISOString().slice(0, 10)}.`}
            </p>
          </div>
          <span className="spacer" />
          {o.demoLink && <a className="btn small" href={o.demoLink} target="_blank" rel="noreferrer">Demo: open {staff ? "the employee" : "the family"}&apos;s page</a>}
          {open && <PacketButtons resend={resendLinkAction.bind(null, p.id)} cancel={cancelOnboardingAction.bind(null, p.id)} />}
          {hired && <PacketButtons resend={resendLinkAction.bind(null, p.id)} />}
          {draft && <PacketButtons send={sendOnboardingAction.bind(null, p.id)} sendWarning={sendWarning} cancel={cancelOnboardingAction.bind(null, p.id)} />}
        </div>
      </div>

      {items.map((i) => (
        <details key={i.id} className="card" open={((open || hired) && i.status === "submitted") || (draft && homeFields(i).length > 0)}>
          <summary className="row" style={{ cursor: "pointer" }}>
            <b>{i.title}</b>{!i.required && <span className="small muted">optional</span>}
            {i.afterHire && <span className="small muted">after hire</span>}
            {i.homeOnly && <span className="small muted">home only</span>}
            <span className="spacer" />
            <span className={`pill ${TONE[i.status]}`}>{i.paper ? "Done on paper" : i.status === "submitted" ? "Ready for review" : ITEM_STATUS[i.status]}</span>
          </summary>
          {i.status === "changes" && i.staffNote && <p className="small"><b>Asked {person}:</b> {i.staffNote}</p>}
          {draft && homeFields(i).length > 0 && <p className="small muted" style={{ margin: 0 }}>Home to fill in: {homeFields(i).join(", ")}.</p>}
          {(open || (hired && i.afterHire)) && i.status !== "approved" && (i.poaMissing.length > 0 || i.staffMissing.length > 0) && (
            <p className="small muted" style={{ margin: 0 }}>
              {i.poaMissing.length > 0 && <>{staff ? "Employee" : "Family"} still to do: {i.poaMissing.slice(0, 4).join(", ")}{i.poaMissing.length > 4 ? "…" : ""}. </>}
              {i.staffMissing.length > 0 && <>Home still to do: {i.staffMissing.join(", ")}.</>}
            </p>
          )}
          <StaffItem
            packetId={p.id}
            item={i}
            open={open || draft || (hired && i.afterHire)}
            draft={draft}
            audience={audience}
            me={me.name}
            consentText={E_SIGN_CONSENT}
            save={staffSaveAction.bind(null, p.id, i.id)}
            sign={staffSignAction.bind(null, p.id, i.id)}
            review={reviewAction.bind(null, p.id, i.id)}
            paperUndo={open || draft ? paperUndoAction.bind(null, p.id, i.id) : undefined}
          />
        </details>
      ))}

      {open && (waiting.length ? (
        <p className="muted">Approve every required item to {staff ? "hire" : "admit"} {p.residentFirstName}. Still waiting on: {waiting.map((i) => i.title).join(", ")}.</p>
      ) : staff ? (
        <HireForm action={hireAction.bind(null, p.id)} name={p.poaName} email={p.poaEmail} roles={roles} homes={myHomes} homeId={p.facilityId} />
      ) : (
        <AdmitForm action={admitAction.bind(null, p.id)} suggested={suggestResident(p, items)} />
      ))}
    </>
  );
}
