import { desc, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { auditLog, facilities, users } from "@/db/schema";
import { canViewAudit } from "@/lib/permissions";
import { requireUser } from "@/lib/session";

export default async function AuditPage() {
  const me = await requireUser();
  if (!canViewAudit(me)) redirect("/dashboard");
  const { rows, tz } = await withTenant(await getDb(), me.orgId, async (tx) => ({
    rows: await tx.select({ log: auditLog, actor: users.name }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorId)).orderBy(desc(auditLog.at)).limit(200),
    // Organization-wide pages show times in the first home's time zone (servers run in UTC).
    tz: (await tx.select({ tz: facilities.timeZone }).from(facilities).limit(1))[0]?.tz ?? "America/New_York",
  }));
  return (
    <>
      <div>
        <h1>Audit log</h1>
        <p className="muted">The latest 200 entries. Entries can be added but never changed or deleted.</p>
      </div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ log, actor }) => (
                <tr key={log.id}>
                  <td className="small">{log.at.toLocaleString("en-US", { timeZone: tz })}</td>
                  <td>{actor ?? "System"}</td>
                  <td>{log.action.replaceAll("_", " ")}</td>
                  <td className="small muted">{Object.keys(log.details).length ? JSON.stringify(log.details) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
