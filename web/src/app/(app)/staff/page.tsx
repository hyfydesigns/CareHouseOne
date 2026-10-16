import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { facilities, roleEnum } from "@/db/schema";
import { canInvite, canViewStaff, ROLE_LABEL } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listStaff } from "@/server/staff";
import { inviteAction, staffAction } from "./actions";
import { InviteForm, RowActions } from "./staff-ui";

const fmtIn = (tz: string) => (d: Date | null) => (d ? d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }) : "—");

export default async function StaffPage() {
  const me = await requireUser();
  if (!canViewStaff(me)) redirect("/dashboard");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const { rows, homes } = await withTenant(await getDb(), me.orgId, async (tx) => ({
    rows: await listStaff(tx, actor),
    homes: await tx.select({ id: facilities.id, name: facilities.name, tz: facilities.timeZone }).from(facilities).orderBy(facilities.name),
  }));
  const fmt = fmtIn(homes[0]?.tz ?? "America/New_York");
  const myHomes = homes.filter((h) => canInvite(actor, "caregiver", [h.id]));
  const roles = roleEnum.enumValues.filter((r) => myHomes.some((h) => canInvite(actor, r, [h.id]))).map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  return (
    <>
      <div className="row">
        <h1>Staff</h1>
        <span className="muted">{rows.filter((r) => r.status === "active").length} active</span>
      </div>
      {roles.length > 0 && <InviteForm action={inviteAction} roles={roles} homes={myHomes} />}
      <section className="card" aria-labelledby="list-h">
        <h2 id="list-h">People</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Role</th>
                <th>Homes</th>
                <th>Status</th>
                <th>Last sign-in</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><br /><span className="small muted">{r.email}</span></td>
                  <td>{ROLE_LABEL[r.role]}</td>
                  <td>{r.facilityNames.join(", ")}</td>
                  <td>
                    {r.status === "active" && <span className="pill ok">Active</span>}
                    {r.status === "invited" && (
                      <span className="stack" style={{ gap: 4 }}>
                        {r.invite?.expired ? <span className="pill warn">Invitation expired</span> : <span className="pill info">{r.invite?.purpose === "reactivate" ? "Reactivation sent" : "Invited"}</span>}
                        {r.invite && <span className="small muted">Sent {fmt(r.invite.sentAt)} · expires {fmt(r.invite.expiresAt)}</span>}
                      </span>
                    )}
                    {r.status === "deactivated" && (
                      <span className="stack" style={{ gap: 4 }}>
                        <span className="pill mute">Deactivated</span>
                        <span className="small muted">{r.deactivationReason} · {fmt(r.deactivatedAt)}</span>
                      </span>
                    )}
                  </td>
                  <td>{fmt(r.lastSignInAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    {r.canManage && <RowActions action={staffAction} userId={r.id} name={r.name} status={r.status} rehireOnly={r.rehireOnly} />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
