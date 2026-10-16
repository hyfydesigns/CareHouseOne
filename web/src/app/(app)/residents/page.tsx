import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listResidents, visibleFacilities } from "@/server/residents";
import { addResidentAction } from "../care-actions";
import { AddResidentForm } from "../care-forms";

export default async function ResidentsPage() {
  const me = await requireUser();
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const { homes, rs } = await withTenant(await getDb(), me.orgId, async (tx) => ({ homes: await visibleFacilities(tx, actor), rs: await listResidents(tx, actor) }));
  return (
    <>
      <div className="row">
        <h1>Residents</h1>
        <span className="muted">{rs.length} living in {homes.length === 1 ? homes[0].name : `${homes.length} homes`}</span>
      </div>
      {homes.map((h) => {
        const list = rs.filter((r) => r.facilityId === h.id);
        return (
          <section key={h.id} className="card" aria-labelledby={`h-${h.id}`}>
            <h2 id={`h-${h.id}`}>{h.name}</h2>
            {list.length ? (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Name</th><th>Room</th><th>Allergies</th><th>Diet</th></tr></thead>
                  <tbody>
                    {list.map((r) => (
                      <tr key={r.id}>
                        <td><Link href={`/residents/${r.id}`}><b>{r.firstName} {r.lastName}</b></Link></td>
                        <td>{r.room}</td>
                        <td>{r.allergies.length ? <span className="pill crit">{r.allergies.join(", ")}</span> : <span className="muted">None known</span>}</td>
                        <td>{r.diet}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted">No residents yet.</p>
            )}
          </section>
        );
      })}
      {canManageCare(me) && homes.length > 0 && <AddResidentForm action={addResidentAction} homes={homes.map((h) => ({ id: h.id, name: h.name }))} />}
    </>
  );
}
