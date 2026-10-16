import { requireUser } from "@/lib/session";
import { canViewAudit, canViewStaff, ROLE_LABEL } from "@/lib/permissions";
import { signOutAction } from "../(auth)/actions";
import { NavLink } from "./nav-link";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const me = await requireUser();
  return (
    <div className="shell">
      <nav className="side" aria-label="Main">
        <div className="brand">
          <span className="mark" aria-hidden="true">C1</span>CareHouse One
        </div>
        <NavLink href="/dashboard">Home</NavLink>
        <NavLink href="/meds">Medication pass</NavLink>
        <NavLink href="/residents">Residents</NavLink>
        {canViewStaff(me) && <NavLink href="/staff">Staff</NavLink>}
        {canViewAudit(me) && <NavLink href="/audit">Audit log</NavLink>}
        {canViewAudit(me) && <NavLink href="/settings">Settings</NavLink>}
        <div className="foot">
          <span>
            Signed in as <b>{me.name}</b>
            <br />
            {ROLE_LABEL[me.role]}
          </span>
          <form action={signOutAction}>
            <button className="linkbtn">Sign out</button>
          </form>
        </div>
      </nav>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
