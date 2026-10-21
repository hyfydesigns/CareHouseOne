import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { FOLLOWUP_KINDS, getIncident, INCIDENT_TYPES, needsStateReport, SEVERITIES, type FollowupKind, type IncidentType } from "@/server/incidents";
import { incidentFollowupAction } from "../actions";
import { FollowupForm } from "../forms";

export default async function IncidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filed?: string }> }) {
  const me = await requireUser();
  const { id } = await params;
  const sp = await searchParams;
  const inc = await withTenant(await getDb(), me.orgId, (tx) => getIncident(tx, me, id));
  if (!inc) notFound();
  const { i, tz } = inc;
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const reviewer = canManageCare(me);
  const missing = [
    !inc.notified.guardian && "guardian or family",
    !inc.notified.physician && (i.injury || i.type === "medication_error" || i.type === "hospital") && "physician or nurse",
    !inc.notified.state && needsStateReport(i) && "state licensing agency",
  ].filter(Boolean);
  return (
    <>
      <div>
        <Link href="/incidents" className="small">‹ Incident reports</Link>
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>{INCIDENT_TYPES[i.type as IncidentType] ?? i.type}</h1>
          <span className={`pill ${i.severity === "serious" ? "crit" : i.severity === "moderate" ? "warn" : "mute"}`}>{SEVERITIES[i.severity as keyof typeof SEVERITIES]}</span>
          {inc.open ? <span className="pill warn">Open</span> : <span className="pill ok">Closed</span>}
        </div>
        <p className="muted">{inc.home}{inc.resident ? ` · ${inc.resident}` : ""} · {when(i.occurredAt)}</p>
      </div>
      {sp.filed && <p className="notice" role="status">Report filed. The owner and admins have been emailed to review it.</p>}
      {reviewer && inc.open && missing.length > 0 && (
        <p className="banner offline" role="status" style={{ margin: 0 }}>Not recorded yet: who notified the {missing.join(", the ")}.</p>
      )}
      <section className="card">
        <dl className="details">
          {i.location && <><dt>Where</dt><dd>{i.location}</dd></>}
          <dt>What happened</dt><dd style={{ whiteSpace: "pre-wrap" }}>{i.description}</dd>
          <dt>Done right away</dt><dd style={{ whiteSpace: "pre-wrap" }}>{i.actionTaken}</dd>
          <dt>Injury</dt><dd style={{ whiteSpace: "pre-wrap" }}>{i.injury ? i.injuryDetails : "No"}</dd>
          {i.witnesses && <><dt>Witnesses</dt><dd>{i.witnesses}</dd></>}
          <dt>Reported by</dt><dd>{inc.by ?? "Unknown"} · {when(i.reportedAt)}</dd>
        </dl>
      </section>
      <section className="card">
        <h2>Follow-ups</h2>
        {inc.followups.length ? (
          <ol className="stack" style={{ margin: 0, paddingLeft: 20 }}>
            {inc.followups.map(({ f, by }) => (
              <li key={f.id}>
                <b>{FOLLOWUP_KINDS[f.kind as FollowupKind] ?? f.kind}</b> <span className="small muted">· {by ?? "Unknown"} · {when(f.recordedAt)}</span>
                {f.details && <div style={{ whiteSpace: "pre-wrap" }}>{f.details}</div>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted" style={{ margin: 0 }}>None yet.{reviewer ? "" : " The owner or admin will add them."}</p>
        )}
      </section>
      {reviewer && <FollowupForm key={String(inc.open)} action={incidentFollowupAction.bind(null, i.id)} kinds={Object.entries(FOLLOWUP_KINDS)} open={inc.open} />}
    </>
  );
}
