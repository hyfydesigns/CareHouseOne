import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { facilities, organizations, type Resident } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { clock, zonedToUtc } from "@/lib/time";
import { BP_POSITIONS, CATEGORY_LABEL, monthNotes, monthVitals, SHIFT_LABEL } from "@/server/care";
import { listDiagnoses } from "@/server/diagnoses";
import { FOLLOWUP_KINDS, getIncident, INCIDENT_TYPES, listIncidents, SEVERITIES, type FollowupKind, type IncidentType } from "@/server/incidents";
import { listOrders, monthRecord } from "@/server/meds";
import { monthAdl } from "@/server/adl";
import { attachmentsFor } from "@/server/attachments";
import { AttachmentThumbs } from "../../(app)/care/attachment-thumbs";
import { AdlGrid } from "../../(app)/adl/grid";
import type { monthFrom } from "../../(app)/care/month";

export const SECTIONS = ["mar", "vitals", "adl", "notes", "incidents"] as const;
export type Section = (typeof SECTIONS)[number];
export const SECTION_LABELS: Array<[Section, string]> = [["mar", "Medication record"], ["vitals", "Vital signs"], ["adl", "Daily care"], ["notes", "Progress notes"], ["incidents", "Incidents"]];

/** The sections named in ?only=, or all of them. */
export const sectionsFrom = (only?: string) => new Set(SECTIONS.filter((s) => !only || only.split(",").includes(s)));

type Month = ReturnType<typeof monthFrom>;

/** Everything one resident's month on paper needs. */
export async function loadResidentMonth(tx: Tx, actor: Actor, r: Resident, m: Month, show: Set<Section>, now: Date) {
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, r.facilityId));
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, r.orgId));
  const following = m.month === 12 ? `${m.year + 1}-01-01` : `${m.year}-${String(m.month + 1).padStart(2, "0")}-01`;
  const from = zonedToUtc(`${m.year}-${String(m.month).padStart(2, "0")}-01`, "00:00", home.timeZone);
  const to = zonedToUtc(following, "00:00", home.timeZone);
  const incidentRows = show.has("incidents") ? await listIncidents(tx, actor, { residentId: r.id, from, to }) : [];
  const incidents = [];
  for (const row of incidentRows) incidents.push((await getIncident(tx, actor, row.i.id))!);
  const noteRows = show.has("notes") ? await monthNotes(tx, r, m.year, m.month) : null;
  return {
    noteFiles: noteRows ? await attachmentsFor(tx, noteRows.rows.map((x) => x.n.id)) : new Map(),
    r,
    home,
    org: org.name,
    m,
    show,
    now,
    diagnoses: (await listDiagnoses(tx, r.id)).filter((d) => !d.removedAt),
    orders: (await listOrders(tx, r.id)).filter((o) => o.order.status === "active"),
    record: show.has("mar") ? await monthRecord(tx, r, m.year, m.month, now) : null,
    vitals: show.has("vitals") ? await monthVitals(tx, r, m.year, m.month) : null,
    notes: noteRows,
    adl: show.has("adl") ? await monthAdl(tx, r, m.year, m.month) : null,
    incidents,
  };
}
export type ResidentMonthData = Awaited<ReturnType<typeof loadResidentMonth>>;

/**
 * A resident's month on paper, for inspectors, pharmacists and the chart: medication record,
 * vital signs, daily care, progress notes and incident reports, with a line to sign.
 */
export function ResidentMonth({ data }: { data: ResidentMonthData }) {
  const { r, home, m, show } = data;
  const tz = home.timeZone;
  const dt = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  const printedAt = data.now.toLocaleString("en-US", { timeZone: tz, month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <>
      <header className="print-head">
        <div>
          <h1>{r.firstName} {r.lastName}</h1>
          <p>{data.org} · {home.name}{r.room ? ` · Room ${r.room}` : ""}</p>
        </div>
        <div className="print-meta">
          <b>{m.label}</b>
          <span>Printed {printedAt}</span>
          <span>Confidential health information</span>
        </div>
      </header>
      <dl className="details print-facts">
        <dt>Date of birth</dt><dd>{r.dateOfBirth ?? "—"}</dd>
        <dt>Allergies</dt><dd><b>{r.allergies.length ? r.allergies.join(", ") : "None known"}</b></dd>
        <dt>Diagnoses</dt><dd>{data.diagnoses.length ? data.diagnoses.map((d) => `${d.code} ${d.label}`).join("; ") : "—"}</dd>
        {r.diet && <><dt>Diet</dt><dd>{r.diet}</dd></>}
        {r.codeStatus && <><dt>Code status</dt><dd>{r.codeStatus}</dd></>}
        {r.guardian && <><dt>Guardian</dt><dd>{r.guardian}{r.guardianPhone ? ` · ${r.guardianPhone}` : ""}</dd></>}
      </dl>

      {data.record && (
        <section className="print-section">
          <h2>Medication administration record</h2>
          <table className="grid-mar print-table">
            <thead>
              <tr>
                <th>Medication · time</th>
                {Array.from({ length: data.record.days }, (_, i) => <th key={i} className="d">{i + 1}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.record.rows.length ? data.record.rows.map((row) => (
                <tr key={`${row.order.id}${row.time}`}>
                  <td><b>{row.order.name}</b> {row.order.strength} · {row.order.route}<br />{clock(row.time)}</td>
                  {row.cells.map((c, i) => (
                    <td key={i} className={`d ${c?.outcome ?? ""}`}>
                      {c ? (c.outcome === "given" ? `${c.by ?? "✓"}${c.late ? "*" : ""}` : c.outcome === "refused" ? "R" : c.outcome === "held" ? "H" : c.outcome === "missed" ? "!" : "") : ""}
                    </td>
                  ))}
                </tr>
              )) : <tr><td colSpan={data.record.days + 1}>No scheduled medications this month.</td></tr>}
            </tbody>
          </table>
          <p className="small">Initials = given by · * = given late · R = refused · H = held · ! = not recorded</p>
          <h3>As-needed doses</h3>
          {data.record.prn.length ? (
            <table className="print-table">
              <thead><tr><th>When</th><th>Medication</th><th>Reason</th><th>Result</th><th>Given by</th></tr></thead>
              <tbody>
                {data.record.prn.map((p) => (
                  <tr key={p.dose.id}><td>{dt(p.dose.recordedAt)}</td><td>{p.order.name} {p.order.strength}</td><td>{p.dose.reason}</td><td>{p.dose.outcome}</td><td>{p.by}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p>None this month.</p>}
          <h3>Current medication orders</h3>
          <table className="print-table">
            <thead><tr><th>Medication</th><th>Route</th><th>When</th><th>Purpose</th><th>Started</th></tr></thead>
            <tbody>
              {data.orders.map(({ order: o }) => (
                <tr key={o.id}><td>{o.name} {o.strength}</td><td>{o.route}</td><td>{o.type === "prn" ? "As needed" : o.times.map(clock).join(", ")}</td><td>{o.purpose}</td><td>{o.startDate}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.vitals && (
        <section className="print-section">
          <h2>Vital signs</h2>
          {data.vitals.rows.length ? (
            <table className="print-table">
              <thead><tr><th>When</th><th>BP</th><th>Pulse</th><th>Temp °F</th><th>Sugar</th><th>O₂ %</th><th>Weight</th><th>Flags</th><th>By</th></tr></thead>
              <tbody>
                {data.vitals.rows.map(({ v, by, reviewedAt }) => (
                  <tr key={v.id}>
                    <td>{dt(v.recordedAt)}</td>
                    <td>{v.systolic}/{v.diastolic}{v.bpPosition ? ` (${BP_POSITIONS[v.bpPosition as keyof typeof BP_POSITIONS].toLowerCase()})` : ""}</td>
                    <td>{v.pulse}</td>
                    <td>{v.tempTenthsF ? (v.tempTenthsF / 10).toFixed(1) : ""}</td>
                    <td>{v.bloodSugar ?? ""}</td>
                    <td>{v.oxygen ?? ""}</td>
                    <td>{v.weightTenthsLb ? (v.weightTenthsLb / 10).toFixed(1) : ""}</td>
                    <td>{v.flags.join(", ")}{v.flags.length ? (reviewedAt ? " (reviewed)" : " (not reviewed)") : ""}</td>
                    <td>{by}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p>No readings this month.</p>}
        </section>
      )}

      {data.adl && (
        <section className="print-section">
          <h2>Daily care (activities of daily living)</h2>
          <AdlGrid month={data.adl} className="grid-mar print-table" />
        </section>
      )}

      {data.notes && (
        <section className="print-section">
          <h2>Progress notes</h2>
          {data.notes.rows.length ? (
            [...data.notes.rows].reverse().map(({ n, by }) => (
              <div key={n.id} className="print-note">
                <div className="small"><b>{dt(n.recordedAt)}</b> · {SHIFT_LABEL[n.shift]} shift · {CATEGORY_LABEL[n.category]} · {by}{n.addendumTo ? " · Addendum" : ""}</div>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
                <AttachmentThumbs items={data.noteFiles.get(n.id)} />
              </div>
            ))
          ) : <p>No notes this month.</p>}
        </section>
      )}

      {show.has("incidents") && (
        <section className="print-section">
          <h2>Incident reports</h2>
          {data.incidents.length ? (
            data.incidents.map((inc) => (
              <div key={inc.i.id} className="print-note">
                <div><b>{INCIDENT_TYPES[inc.i.type as IncidentType] ?? inc.i.type}</b> · {SEVERITIES[inc.i.severity as keyof typeof SEVERITIES]} · {dt(inc.i.occurredAt)}{inc.i.location ? ` · ${inc.i.location}` : ""} · {inc.open ? "Open" : "Closed"}</div>
                <div style={{ whiteSpace: "pre-wrap" }}><b>What happened:</b> {inc.i.description}</div>
                <div style={{ whiteSpace: "pre-wrap" }}><b>Done right away:</b> {inc.i.actionTaken}</div>
                <div><b>Injury:</b> {inc.i.injury ? inc.i.injuryDetails : "No"}{inc.i.witnesses ? ` · Witnesses: ${inc.i.witnesses}` : ""}</div>
                <div className="small">Reported by {inc.by} on {dt(inc.i.reportedAt)}</div>
                {inc.followups.map(({ f, by }) => (
                  <div key={f.id} className="small">{FOLLOWUP_KINDS[f.kind as FollowupKind] ?? f.kind} · {by} · {dt(f.recordedAt)}{f.details ? `: ${f.details}` : ""}</div>
                ))}
              </div>
            ))
          ) : <p>No incidents this month.</p>}
        </section>
      )}

      <footer className="print-sign">
        <span>Reviewed by: ______________________________</span>
        <span>Signature: ______________________________</span>
        <span>Date: ______________</span>
      </footer>
    </>
  );
}
