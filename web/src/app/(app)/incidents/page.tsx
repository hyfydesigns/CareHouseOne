import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { INCIDENT_TYPES, listIncidents, needsStateReport, SEVERITIES, type IncidentType } from "@/server/incidents";

const when = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });

export default async function IncidentsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const show = sp.show === "closed" ? "closed" : sp.show === "all" ? undefined : "open";
  const rows = await withTenant(await getDb(), me.orgId, (tx) => listIncidents(tx, me, { status: show }));
  const reviewer = canManageCare(me);
  return (
    <>
      <div className="row">
        <div>
          <h1>Incident reports</h1>
          <p className="muted">{reviewer ? "Every report filed at your homes." : "Reports you've filed."}</p>
        </div>
        <span className="spacer" />
        <Link className="btn primary big" href="/incidents/new">Report an incident</Link>
      </div>
      <div className="row" style={{ gap: 6 }}>
        {[["open", "Open"], ["closed", "Closed"], ["all", "All"]].map(([k, l]) => (
          <Link key={k} className={`btn small ${(show ?? "all") === k ? "primary" : ""}`} href={`/incidents?show=${k}`}>{l}</Link>
        ))}
      </div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Home</th><th>Resident</th><th>What</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>
              {rows.length ? rows.map((r) => (
                <tr key={r.i.id}>
                  <td><Link href={`/incidents/${r.i.id}`}>{when(r.i.occurredAt, r.tz)}</Link></td>
                  <td>{r.home}</td>
                  <td>{r.resident ?? <span className="muted">—</span>}</td>
                  <td>{INCIDENT_TYPES[r.i.type as IncidentType] ?? r.i.type}</td>
                  <td><span className={`pill ${r.i.severity === "serious" ? "crit" : r.i.severity === "moderate" ? "warn" : "mute"}`}>{SEVERITIES[r.i.severity as keyof typeof SEVERITIES]}</span></td>
                  <td>
                    {r.open ? <span className="pill warn">Open</span> : <span className="pill ok">Closed</span>}
                    {r.open && needsStateReport(r.i) && <span className="small muted"> · check state reporting</span>}
                  </td>
                </tr>
              )) : <tr><td colSpan={6} className="muted">No {show ?? ""} reports.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
