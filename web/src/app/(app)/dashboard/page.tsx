import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities, organizations, userFacilities, users } from "@/db/schema";
import { requireUser } from "@/lib/session";

export default async function DashboardPage() {
  const me = await requireUser();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, me.orgId));
    const homes = await tx.select().from(facilities).orderBy(facilities.name);
    const staff = await tx.select({ userId: userFacilities.userId, facilityId: userFacilities.facilityId, status: users.status }).from(userFacilities).innerJoin(users, eq(users.id, userFacilities.userId));
    return { org, homes, staff };
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
      <p className="muted small">Vitals, progress notes, shift sign-in and diagnoses arrive in the next build stage.</p>
    </>
  );
}
