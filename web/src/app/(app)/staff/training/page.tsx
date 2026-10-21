import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canManageCare, ROLE_LABEL } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { visibleFacilities } from "@/server/residents";
import { CERT_KINDS, certName, trainingOverview, type CertStatus } from "@/server/training";
import { addCertificationAction, removeCertificationAction } from "../../ops-actions";
import { CertificationForm, RemoveCertButton } from "../../ops-forms";

const PILL: Record<CertStatus, [string, string]> = { expired: ["crit", "Expired"], expiring: ["warn", "Expires soon"], current: ["ok", "Current"], no_expiry: ["mute", "No expiry"] };

export default async function TrainingPage({ searchParams }: { searchParams: Promise<{ person?: string }> }) {
  const me = await requireUser();
  if (!canManageCare(me)) redirect("/dashboard");
  const sp = await searchParams;
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const [home] = await visibleFacilities(tx, me);
    const today = localDate(new Date(), home?.timeZone ?? "America/Chicago");
    return { today, people: await trainingOverview(tx, today) };
  });
  const attention = data.people.filter((p) => p.worst !== "ok").length;
  return (
    <>
      <div>
        <Link href="/staff" className="small">‹ Staff</Link>
        <h1>Training and certifications</h1>
        <p className="muted">
          {attention ? `${attention} ${attention === 1 ? "person needs" : "people need"} attention.` : "Nothing expired or expiring in the next 30 days."} Owners, admins and the person get an
          email 30 days before something expires and on the day it does.
        </p>
      </div>
      <CertificationForm action={addCertificationAction} people={data.people.map((p) => ({ id: p.id, name: p.name }))} kinds={Object.entries(CERT_KINDS)} defaultUser={sp.person} />
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Person</th><th>Training</th><th>Completed</th><th>Expires</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {data.people.flatMap((p) =>
                p.certs.length
                  ? p.certs.map((c, i) => (
                      <tr key={c.id}>
                        <td>{i === 0 && <><b>{p.name}</b><div className="small muted">{ROLE_LABEL[p.role]}</div></>}</td>
                        <td>{certName(c)}{c.notes && <div className="small muted">{c.notes}</div>}</td>
                        <td>{c.issuedOn ?? "—"}</td>
                        <td>{c.expiresOn ?? "—"}</td>
                        <td><span className={`pill ${PILL[c.status][0]}`}>{PILL[c.status][1]}</span></td>
                        <td><RemoveCertButton action={removeCertificationAction.bind(null, c.id)} name={certName(c)} /></td>
                      </tr>
                    ))
                  : [
                      <tr key={p.id}>
                        <td><b>{p.name}</b><div className="small muted">{ROLE_LABEL[p.role]}</div></td>
                        <td colSpan={5} className="muted">No training recorded. <Link href={`/staff/training?person=${p.id}`}>Add</Link></td>
                      </tr>,
                    ],
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
