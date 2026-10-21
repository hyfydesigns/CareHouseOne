import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { billingState, orgSubscription } from "@/server/billing";
import { canViewAudit, canViewStaff, ROLE_LABEL } from "@/lib/permissions";
import { IdleLock } from "@/components/idle-lock";
import { OfflineProvider } from "@/components/offline";
import { idleLockAction, lockAction, signOutAction } from "../(auth)/actions";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const isCaregiver = me.role === "caregiver" || me.role === "med_caregiver";
  // Billing problems are shown to owners and admins only; caregivers' screens never change.
  const billing = canViewAudit(me) ? billingState(await withTenant(await getDb(), me.orgId, orgSubscription)) : null;
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <span className="mark" aria-hidden="true">C1</span>CareHouse One
        </div>
        {isCaregiver ? (
          <>
            {/* The shared-tablet menu: only what caregivers need on shift. */}
            <NavLink href="/meds">Medication &amp; Diagnosis</NavLink>
            <NavLink href="/shift">Sign In / Sign Out</NavLink>
            <NavLink href="/vitals">Vital Signs</NavLink>
            <NavLink href="/notes">Progress Notes</NavLink>
          </>
        ) : (
          <>
            <NavLink href="/dashboard">Home</NavLink>
            <NavLink href="/meds">Medication pass</NavLink>
            <NavLink href="/residents">Residents</NavLink>
            <NavLink href="/vitals">Vital signs</NavLink>
            <NavLink href="/notes">Progress notes</NavLink>
            <NavLink href="/shift">Sign in / out</NavLink>
          </>
        )}
        {canViewStaff(me) && <NavLink href="/staff">Staff</NavLink>}
        {canViewAudit(me) && <NavLink href="/timesheets">Timesheets</NavLink>}
        {canViewAudit(me) && <NavLink href="/audit">Audit log</NavLink>}
        {canViewAudit(me) && <NavLink href="/settings">Settings</NavLink>}
        <div className="foot">
          <span>
            Signed in as <b>{me.name}</b>
            <br />
            {ROLE_LABEL[me.role]}
            {me.device && (
              <>
                <br />
                <span className="small">Tablet · {me.device.name}</span>
              </>
            )}
          </span>
          {!me.device && <Link href="/account">Account</Link>}
          {me.device && (
            <form action={lockAction}>
              <button className="linkbtn">Lock</button>
            </form>
          )}
          <form action={signOutAction}>
            <button className="linkbtn">Sign out</button>
          </form>
        </div>
      </nav>
      <main className="main" id="main">
        <OfflineProvider userId={me.id}>
          {billing?.warning && (
            <div className={`banner ${billing.tone === "crit" ? "error" : "offline"}`} role="status">
              {billing.warning} <Link href="/settings#billing" style={{ marginLeft: 6 }}>Billing</Link>
            </div>
          )}
          {children}
        </OfflineProvider>
      </main>
      {me.device && <IdleLock minutes={2} lock={idleLockAction} />}
    </div>
  );
}
