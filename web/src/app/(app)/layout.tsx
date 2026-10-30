import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { billingState, orgSubscription } from "@/server/billing";
import { canViewAudit, canViewStaff, ROLE_LABEL } from "@/lib/permissions";
import { IdleLock } from "@/components/idle-lock";
import { OfflineProvider } from "@/components/offline";
import { idleLockAction, lockAction, signOutAction } from "../(auth)/actions";
import { NavLink } from "./nav-link";
import { SideNav } from "./side-nav";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  const isCaregiver = me.role === "caregiver" || me.role === "med_caregiver";
  // Billing problems are shown to owners and admins only; caregivers' screens never change.
  const billing = canViewAudit(me) ? billingState(await withTenant(await getDb(), me.orgId, orgSubscription)) : null;
  return (
    <div className="shell">
      <SideNav>
        {isCaregiver ? (
          <>
            {/* The shared-tablet menu: only what caregivers need on shift. */}
            <NavLink href="/meds" icon="pill">Medication &amp; Diagnosis</NavLink>
            <NavLink href="/shift" icon="clock">Start / End Shift</NavLink>
            <NavLink href="/vitals" icon="pulse">Vital Signs</NavLink>
            <NavLink href="/adl" icon="heart">Daily Care</NavLink>
            <NavLink href="/notes" icon="notes">Progress Notes</NavLink>
            <NavLink href="/incidents" icon="alert">Incident Reports</NavLink>
          </>
        ) : (
          <>
            <NavLink href="/dashboard" icon="home">Home</NavLink>
            <NavLink href="/meds" icon="pill">Medication pass</NavLink>
            <NavLink href="/residents" icon="residents">Residents</NavLink>
            <NavLink href="/vitals" icon="pulse">Vital signs</NavLink>
            <NavLink href="/adl" icon="heart">Daily care</NavLink>
            <NavLink href="/notes" icon="notes">Progress notes</NavLink>
            <NavLink href="/shift" icon="clock">Shifts</NavLink>
            <NavLink href="/incidents" icon="alert">Incidents</NavLink>
          </>
        )}
        {canViewStaff(me) && <NavLink href="/staff" icon="staff">Staff</NavLink>}
        {canViewAudit(me) && <NavLink href="/safety" icon="shield">Safety checks</NavLink>}
        {canViewAudit(me) && <NavLink href="/timesheets" icon="calendar">Timesheets</NavLink>}
        {canViewAudit(me) && <NavLink href="/audit" icon="list">Audit log</NavLink>}
        {canViewAudit(me) && <NavLink href="/settings" icon="settings">Settings</NavLink>}
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
      </SideNav>
      <main className="main" id="main">
        <OfflineProvider userId={me.id}>
          {process.env.DEMO_MODE === "true" && (
            <div className="banner" role="note">
              <b>Demo.</b> Everyone here is made up, and it all goes back to the start on its own. Please don&apos;t enter real information.
              <Link href="/demo" style={{ marginLeft: 6 }}>Switch between owner and caregiver</Link>
            </div>
          )}
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
