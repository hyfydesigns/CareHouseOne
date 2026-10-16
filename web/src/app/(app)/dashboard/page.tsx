import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities, organizations, userFacilities, users } from "@/db/schema";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { canManageCare } from "@/lib/permissions";
import { unreviewedVitals } from "@/server/care";
import { reviewVitalAction } from "../care/actions";
import { ReviewButton } from "../care/forms";

export default async function DashboardPage() {
  const me = await requireUser();
  if (me.role === "caregiver" || me.role === "med_caregiver") redirect("/meds");
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, me.orgId));
    const homes = await tx.select().from(facilities).orderBy(facilities.name);
    const staff = await tx.select({ userId: userFacilities.userId, facilityId: userFacilities.facilityId, status: users.status }).from(userFacilities).innerJoin(users, eq(users.id, userFacilities.userId));
    const review = canManageCare(me) ? await unreviewedVitals(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }) : [];
    return { org, homes, staff, review };
  });
  const visible = me.role === "owner" || me.role === "admin" ? data.homes : data.homes.filter((h) => me.facilityIds.includes(h.id));
  const count = (fid: string, status: string) => data.staff.filter((s) => s.facilityId === fid && s.status === status).length;
  return (
    <>
      <div>
        <h1>Good to see you, {me.name.split(" ")[0]}</h1>
        <p className="muted">{data.org?.name}</p>
      </div>
      <section className="card" aria-labelledby="homes-h">
        <h2 id="homes-h">{visible.length === 1 ? "Your home" : "Homes"}</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Home</th>
                <th>Type</th>
                <th>Licensed beds</th>
                <th>Active staff</th>
                <th>Invited</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((h) => (
                <tr key={h.id}>
                  <td><b>{h.name}</b></td>
                  <td>{h.licenseType}</td>
                  <td>{h.beds}</td>
                  <td>{count(h.id, "active")}</td>
                  <td>{count(h.id, "invited")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {data.review.length > 0 && (
        <section className="card" style={{ borderColor: "var(--crit)" }} aria-labelledby="rev-h">
          <h2 id="rev-h">Readings to review</h2>
          <div className="tablewrap">
            <table>
              <tbody>
                {data.review.map(({ v, r, by }) => (
                  <tr key={v.id}>
                    <td><Link href={`/residents/${r.id}?tab=vitals`}><b>{r.firstName} {r.lastName}</b></Link><br /><span className="small muted">{v.recordedAt.toLocaleString("en-US", { timeZone: data.homes.find((h) => h.id === r.facilityId)?.timeZone, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} · {by}</span></td>
                    <td>BP {v.systolic}/{v.diastolic} · pulse {v.pulse}{v.tempTenthsF != null ? ` · ${(v.tempTenthsF / 10).toFixed(1)} °F` : ""}{v.oxygen != null ? ` · O2 ${v.oxygen}%` : ""}<br /><span className="pill crit">Check {v.flags.join(", ")}</span></td>
                    <td style={{ textAlign: "right" }}><ReviewButton action={reviewVitalAction} vitalId={v.id} residentId={r.id} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
