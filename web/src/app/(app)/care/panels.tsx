import Link from "next/link";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities, type Resident } from "@/db/schema";
import { canManageCare } from "@/lib/permissions";
import type { SessionUser } from "@/server/auth";
import { BP_POSITIONS, CATEGORY_LABEL, monthNotes, monthVitals, SHIFT_LABEL, shiftAt } from "@/server/care";
import { childCodes, currentCodeSet, listDiagnoses, searchIcd } from "@/server/diagnoses";
import { localDate, localTime } from "@/lib/time";
import { addDiagnosisAction, noteAction, removeDiagnosisAction, reviewVitalAction, vitalsAction } from "./actions";
import { AddDiagnosisButton, AddendumButton, NoteForm, RemoveDiagnosisButton, ReviewButton, VitalsForm } from "./forms";
import { monthFrom } from "./month";

const when = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
const tenths = (n: number | null, unit: string) => (n == null ? "—" : `${(n / 10).toFixed(1)}${unit}`);

async function homeTz(residentFacility: string, orgId: string) {
  return withTenant(await getDb(), orgId, async (tx) => (await tx.select().from(facilities).where(eq(facilities.id, residentFacility)))[0].timeZone);
}

function MonthNav({ base, m }: { base: string; m: ReturnType<typeof monthFrom> }) {
  return (
    <div className="row">
      <Link className="btn small" href={`${base}&m=${m.prev}`}>‹ {m.prevLabel}</Link>
      <b>{m.label}</b>
      {m.next && <Link className="btn small" href={`${base}&m=${m.next}`}>{m.nextLabel} ›</Link>}
      {!m.isCurrent && <Link className="btn small" href={base}>This month</Link>}
    </div>
  );
}

export async function VitalsPanel({ resident: r, me, mParam, base }: { resident: Resident; me: SessionUser; mParam?: string; base: string }) {
  const tz = await homeTz(r.facilityId, me.orgId);
  const m = monthFrom(mParam, localDate(new Date(), tz));
  const data = await withTenant(await getDb(), me.orgId, (tx) => monthVitals(tx, r, m.year, m.month));
  const last = data.rows[0]?.v;
  const nurse = canManageCare(me);
  return (
    <>
      {m.isCurrent && <VitalsForm key={r.id} action={vitalsAction} residentId={r.id} lastReading={last ? `${when(last.recordedAt, tz)} · BP ${last.systolic}/${last.diastolic}${last.bpPosition === "lying" ? " (lying down)" : ""} · pulse ${last.pulse}${last.bloodSugar != null ? ` · sugar ${last.bloodSugar} mg/dL` : ""}` : undefined} />}
      <section className="card">
        <div className="row"><h2>Vital signs history</h2><span className="spacer" /><MonthNav base={base} m={m} /></div>
        <div className="kpis">
          <div className="card" style={{ padding: 12 }}><span className="small muted">Readings</span><b style={{ fontSize: 22 }}>{data.rows.length}</b></div>
          <div className="card" style={{ padding: 12 }}><span className="small muted">Average BP</span><b style={{ fontSize: 22 }}>{data.averageBp ?? "—"}</b></div>
          <div className="card" style={{ padding: 12 }}><span className="small muted">Out of range</span><b style={{ fontSize: 22, color: data.flagged ? "var(--crit)" : undefined }}>{data.flagged}</b></div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>BP</th><th>Pulse</th><th>Temp</th><th>Sugar</th><th>O2</th><th>Weight</th><th>By</th><th></th></tr></thead>
            <tbody>
              {data.rows.length ? data.rows.map(({ v, by, reviewedAt }) => (
                <tr key={v.id}>
                  <td>{when(v.recordedAt, tz)}</td>
                  <td>
                    {v.systolic}/{v.diastolic}
                    {v.bpPosition && <span className="small muted"><br />{BP_POSITIONS[v.bpPosition as keyof typeof BP_POSITIONS] ?? v.bpPosition}</span>}
                  </td>
                  <td>{v.pulse}</td>
                  <td>{tenths(v.tempTenthsF, " °F")}</td>
                  <td>{v.bloodSugar == null ? "—" : `${v.bloodSugar} mg/dL`}</td>
                  <td>{v.oxygen == null ? "—" : `${v.oxygen}%`}</td>
                  <td>{tenths(v.weightTenthsLb, " lb")}</td>
                  <td className="small">{by}</td>
                  <td>
                    {v.flags.length > 0 && (reviewedAt ? <span className="pill ok">Reviewed</span> : <span className="stack" style={{ gap: 4 }}><span className="pill crit">Check {v.flags.join(", ")}</span>{nurse && <ReviewButton action={reviewVitalAction} vitalId={v.id} residentId={r.id} />}</span>)}
                  </td>
                </tr>
              )) : <tr><td colSpan={9} className="muted">No readings this month.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export async function NotesPanel({ resident: r, me, mParam, base }: { resident: Resident; me: SessionUser; mParam?: string; base: string }) {
  const tz = await homeTz(r.facilityId, me.orgId);
  const now = new Date();
  const m = monthFrom(mParam, localDate(now, tz));
  const data = await withTenant(await getDb(), me.orgId, (tx) => monthNotes(tx, r, m.year, m.month));
  const byId = new Map(data.rows.map((x) => [x.n.id, x]));
  return (
    <>
      {m.isCurrent && <NoteForm key={r.id} action={noteAction} residentId={r.id} shift={shiftAt(localTime(now, tz))} firstName={r.firstName} />}
      <section className="card">
        <div className="row"><h2>Progress notes</h2><span className="spacer" /><MonthNav base={base} m={m} /></div>
        {data.rows.length ? data.rows.map(({ n, by }) => (
          <div key={n.id} className="dose" style={{ display: "grid", gap: 4 }}>
            <div className="row" style={{ gap: 8 }}>
              <b>{when(n.recordedAt, tz)}</b>
              <span className="muted small">{SHIFT_LABEL[n.shift]} shift</span>
              <span className={`pill ${n.category === "health" || n.category === "behavior" ? "warn" : "info"}`}>{CATEGORY_LABEL[n.category]}</span>
              {n.addendumTo && <span className="pill mute">Addendum{byId.get(n.addendumTo) ? ` to ${when(byId.get(n.addendumTo)!.n.recordedAt, tz)}` : ""}</span>}
              <span className="spacer" />
              <span className="small muted">{by}</span>
            </div>
            <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span>
            {m.isCurrent && !n.addendumTo && <AddendumButton action={noteAction} residentId={r.id} noteId={n.id} shift={n.shift} category={n.category} />}
          </div>
        )) : <p className="muted">No notes this month.</p>}
      </section>
    </>
  );
}

export async function DiagnosesPanel({ resident: r, me, q, cat, base }: { resident: Resident; me: SessionUser; q?: string; cat?: string; base: string }) {
  const nurse = canManageCare(me);
  const tz = await homeTz(r.facilityId, me.orgId);
  const data = await withTenant(await getDb(), me.orgId, async (tx) => ({
    list: await listDiagnoses(tx, r.id),
    version: await currentCodeSet(tx),
    results: nurse && q ? await searchIcd(tx, q) : [],
    children: nurse && cat ? await childCodes(tx, cat) : [],
  }));
  const active = data.list.filter((d) => !d.removedAt);
  const past = data.list.filter((d) => d.removedAt);
  const have = new Set(active.map((d) => d.code));
  return (
    <>
      <section className="card">
        <h2>Diagnoses</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Diagnosis</th><th>ICD-10-CM</th><th>Added</th><th></th></tr></thead>
            <tbody>
              {active.length ? active.map((d) => (
                <tr key={d.id}>
                  <td><b>{d.label}</b>{d.label !== d.officialDescription && <><br /><span className="small muted">{d.officialDescription}</span></>}{d.needsUpdate && <><br /><span className="pill warn">Needs a new code for {data.version}</span></>}</td>
                  <td className="wristband" style={{ fontSize: 15 }}>{d.code}</td>
                  <td className="small">{d.addedAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" })}<br /><span className="muted">{d.addedByName} · {d.codeSetVersion}</span></td>
                  <td style={{ textAlign: "right" }}>{nurse && <RemoveDiagnosisButton action={removeDiagnosisAction} residentId={r.id} diagnosisId={d.id} code={d.code} />}</td>
                </tr>
              )) : <tr><td colSpan={4} className="muted">No diagnoses recorded.</td></tr>}
            </tbody>
          </table>
        </div>
        {!nurse && <p className="small muted">Diagnoses are added and updated by an owner or admin.</p>}
      </section>
      {nurse && (
        <section className="card">
          <h2>Add a diagnosis</h2>
          <form method="get" action={base.split("?")[0]} className="row">
            {base.includes("?") && base.split("?")[1].split("&").map((kv) => { const [k, v] = kv.split("="); return <input key={k} type="hidden" name={k} value={decodeURIComponent(v)} />; })}
            <label htmlFor="q" className="sr-only">Search ICD-10-CM</label>
            <input id="q" name="q" defaultValue={q} placeholder="Search by name or code, for example epilepsy or G40" style={{ flex: "1 1 280px" }} />
            <button className="btn">Search</button>
          </form>
          {(cat ? data.children : data.results).length > 0 && (
            <div className="tablewrap">
              <table>
                <tbody>
                  {cat && <tr><td colSpan={3}><span className="pill warn">{cat} is a category</span> Choose a more specific code:</td></tr>}
                  {(cat ? data.children : data.results).map((x) => (
                    <tr key={x.code}>
                      <td className="wristband" style={{ fontSize: 15 }}>{x.code}</td>
                      <td>{x.description}{!x.billable && <> <span className="pill warn">Category</span></>}{have.has(x.code) && <> <span className="pill mute">Already listed</span></>}</td>
                      <td style={{ textAlign: "right" }}>
                        {!x.billable ? <Link className="btn small" href={`${base}&cat=${encodeURIComponent(x.code)}`}>More specific codes</Link> : !have.has(x.code) && <AddDiagnosisButton action={addDiagnosisAction} residentId={r.id} code={x.code} description={x.description} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {q && !cat && data.results.length === 0 && <p className="muted">No matching codes.</p>}
          <p className="small muted">ICD-10-CM {data.version ?? ""}. Only billable codes can be saved; categories lead to their specific codes.</p>
        </section>
      )}
      {past.length > 0 && (
        <section className="card">
          <h2>Past diagnoses</h2>
          <div className="tablewrap"><table><tbody>{past.map((d) => <tr key={d.id}><td>{d.label}</td><td className="wristband" style={{ fontSize: 14 }}>{d.code}</td><td className="small muted">Removed {d.removedAt!.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" })} · {d.removeReason}</td></tr>)}</tbody></table></div>
        </section>
      )}
    </>
  );
}
