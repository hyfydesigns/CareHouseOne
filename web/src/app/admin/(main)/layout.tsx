import { requireAdmin } from "@/lib/admin-session";
import { NavLink } from "../../(app)/nav-link";
import { SideNav } from "../../(app)/side-nav";
import { adminSignOutAction } from "../actions";

export const metadata = { title: "Admin · CareHouse One" };

/** The admin site: clients, billing, contracts and leads. Never resident information. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="shell">
      <SideNav>
        <NavLink href="/admin" icon="home" exact>Overview</NavLink>
        <NavLink href="/admin/clients" icon="residents">Clients</NavLink>
        <NavLink href="/admin/billing" icon="calendar">Billing</NavLink>
        <NavLink href="/admin/contracts" icon="clipboard">Contracts</NavLink>
        <NavLink href="/admin/leads" icon="list">Leads</NavLink>
        <div className="foot">
          <span>
            Admin · <b>{admin.name}</b>
          </span>
          <form action={adminSignOutAction}>
            <button className="linkbtn">Sign out</button>
          </form>
        </div>
      </SideNav>
      <main className="main" id="main">
        {children}
      </main>
    </div>
  );
}
