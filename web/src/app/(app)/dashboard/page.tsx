import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { organizations, userFacilities, users } from "@/db/schema";
import { redirect } from "next/navigation";
import Link from "next/link";
import { requireUser } from "@/lib/session";
import { canManageCare } from "@/lib/permissions";
import { unreviewedVitals } from "@/server/care";
import { openIncidentCount } from "@/server/incidents";
import { appointmentFollowUps, upcomingAppointments } from "@/server/appointments";
import { overdueSafety } from "@/server/operations";
import { trainingOverview } from "@/server/training";
import { localDate } from "@/lib/time";
import { fmtCount, overdueFollowups, runningLow } from "@/server/meds";
import { homeSummaries } from "@/server/dashboard";
import { reviewVitalAction } from "../care/actions";
import { ReviewButton } from "../care/forms";

const clock = (d: Date, tz: string) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });

export default async function DashboardPage() {
  const me = await requireUser();
  if (me.role === "caregiver" || me.role === "med_caregiver") redirect("/meds");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const [org] = await tx.select().from(organizations).where(eq(organizations.id, me.orgId));
    const homes = await homeSummaries(tx, actor, now);
    const staff = await tx.select({ userId: userFacilities.userId, facilityId: userFacilities.facilityId, status: users.status }).from(userFacilities).innerJoin(users, eq(users.id, userFacilities.userId));
    const review = canManageCare(me) ? await unreviewedVitals(tx, actor) : [];
    const followups = await overdueFollowups(tx, actor, now);
    const low = canManageCare(me) ? await runningLow(tx, actor) : [];
    const incidents = await openIncidentCount(tx, actor);
    const ids = homes.map((h) => h.id);
    const appts = await upcomingAppointments(tx, actor, ids, now, 7);
    const apptFollowUps = await appointmentFollowUps(tx, actor, now);
    const safety = await overdueSafety(tx, actor, homes, now);
    const training = canManageCare(me) ? (await trainingOverview(tx, localDate(now, homes[0]?.timeZone ?? "America/Chicago"))).filter((p) => p.worst !== "ok") : [];
    return { org, homes, staff, review, followups, low, incidents, appts, apptFollowUps, safety, training };
  });
  return (
    <>
      <div>
        <h1>Good to see you, {me.name.split(" ")[0]}</h1>
        <p className="muted">{data.org?.name}</p>
      </div>
      {data.safety.length > 0 && (
        <p className="banner offline" role="status" style={{ margin: 0 }}>
          Safety checks due: {data.safety.map((s) => `${s.home} (${s.overdue.join(", ").toLowerCase()})`).join("; ")}. <Link href="/safety">Record them</Link>
        </p>
      )}
      {data.training.length > 0 && (
        <p className="banner offline" role="status" style={{ margin: 0 }}>
          Training expired or expiring within 30 days: {data.training.map((p) => p.name).join(", ")}. <Link href="/staff/training">See training</Link>
        </p>
      )}
      {data.incidents > 0 && (
        <p className="banner offline" role="status" style={{ margin: 0 }}>
          {data.incidents} open incident report{data.incidents === 1 ? "" : "s"} to follow up. <Link href="/incidents">Review them</Link>
        </p>
      )}
      <div className="homes">
        {data.homes.map((h) => {
          const d = h.doses;
          const done = d.given + d.refused + d.held;
          const staff = data.staff.filter((s) => s.facilityId === h.id && s.status === "active").length;
          return (
            <section className="card" key={h.id} aria-labelledby={`home-${h.id}`}>
              <div className="row">
                <h2 id={`home-${h.id}`} style={{ margin: 0 }}>{h.name}</h2>
                <span className="spacer" />
                {d.late > 0 || h.followupsOverdue > 0 || h.readingsToReview > 0 ? <span className="pill crit">Needs attention</span> : <span className="pill ok">On track</span>}
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {h.residents} resident{h.residents === 1 ? "" : "s"} · {h.beds} beds · {staff} active staff · today {localDate(now, h.timeZone)} · {clock(now, h.timeZone)}
              </p>
              <div>
                <h3 className="small" style={{ margin: "4px 0" }}>Medications today</h3>
                <div className="stat-row">
                  <span className={`stat ${d.total && done === d.total ? "good" : "info"}`}><b>{done}/{d.total}</b><span>done</span></span>
                  <span className={`stat ${d.late ? "crit" : ""}`}><b>{d.late}</b><span>late, not recorded</span></span>
                  <span className={`stat ${d.due ? "warn" : ""}`}><b>{d.due}</b><span>due now</span></span>
                  <span className="stat"><b>{d.refused + d.held}</b><span>refused or held</span></span>
                  <span className={`stat ${h.followupsOverdue ? "crit" : ""}`}><b>{h.followupsOverdue}</b><span>PRN follow-ups overdue</span></span>
                </div>
              </div>
              <div>
                <h3 className="small" style={{ margin: "4px 0" }}>Records today</h3>
                <div className="stat-row">
                  <span className={`stat ${h.vitalsToday ? "info" : ""}`}><b>{h.vitalsToday}</b><span>vital signs</span></span>
                  <span className={`stat ${h.readingsToReview ? "crit" : ""}`}><b>{h.readingsToReview}</b><span>readings to review</span></span>
                  <span className={`stat ${h.notesToday ? "info" : ""}`}><b>{h.notesToday}</b><span>progress notes</span></span>
                </div>
              </div>
              <div>
                <h3 className="small" style={{ margin: "4px 0" }}>On shift now</h3>
                {h.onShift.length ? (
                  <p style={{ margin: 0 }}>{h.onShift.map((p) => `${p.name} (since ${clock(p.since, h.timeZone)})`).join(", ")}</p>
                ) : (
                  <p className="muted" style={{ margin: 0 }}>No one is signed in.</p>
                )}
              </div>
              <p className="small muted" style={{ margin: 0 }}>
                {h.tablets.length
                  ? `Tablet: ${h.tablets.map((t) => `${t.name}, last used ${t.lastSeenAt ? `${clock(t.lastSeenAt, h.timeZone)} ${localDate(t.lastSeenAt, h.timeZone) === localDate(now, h.timeZone) ? "today" : localDate(t.lastSeenAt, h.timeZone)}` : "never"}`).join("; ")}`
                  : "No tablet registered. Shift sign-in won't work here until one is (Settings)."}
              </p>
              <div className="row">
                <Link className="btn small" href={`/meds?home=${h.id}`}>Medication pass</Link>
                <Link className="btn small" href="/residents">Residents</Link>
              </div>
            </section>
          );
        })}
      </div>
      {data.followups.length > 0 && (
        <section className="card" style={{ borderColor: "var(--crit)" }} aria-labelledby="fu-h">
          <h2 id="fu-h">As-needed follow-ups overdue</h2>
          <div className="tablewrap">
            <table>
              <tbody>
                {data.followups.map(({ f, r, name }) => {
                  const tz = data.homes.find((h) => h.id === r.facilityId)?.timeZone ?? "UTC";
                  return (
                    <tr key={f.id}>
                      <td><Link href={`/meds?home=${r.facilityId}#r-${r.id}`}><b>{r.firstName} {r.lastName}</b></Link></td>
                      <td>{name}</td>
                      <td><span className="pill crit">Due {f.dueAt.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>A caregiver on shift should check how each dose worked and record it on the medication screen.</p>
        </section>
      )}
      {(data.appts.length > 0 || data.apptFollowUps.length > 0) && (
        <section className="card" aria-labelledby="appt-h">
          <h2 id="appt-h">Appointments</h2>
          {data.appts.length > 0 && (
            <div className="tablewrap">
              <table>
                <tbody>
                  {data.appts.map((x) => (
                    <tr key={x.a.id}>
                      <td>{x.a.scheduledAt.toLocaleString("en-US", { timeZone: x.tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</td>
                      <td><Link href={`/residents/${x.a.residentId}?tab=appointments`}><b>{x.resident}</b></Link> · {x.home}</td>
                      <td>{x.a.provider} · {x.a.purpose}</td>
                      <td>{x.needsOutcome && <span className="pill warn">Record how it went</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.apptFollowUps.length > 0 && (
            <>
              <h3 style={{ margin: 0 }}>Follow-ups from recent appointments</h3>
              <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
                {data.apptFollowUps.map((x) => (
                  <li key={x.a.id}><Link href={`/residents/${x.a.residentId}?tab=appointments`}>{x.resident}</Link> ({x.a.provider}): {x.a.followUp}</li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {data.low.length > 0 && (
        <section className="card" style={{ borderColor: "var(--warn)" }} aria-labelledby="low-h">
          <h2 id="low-h">Running low</h2>
          <div className="tablewrap">
            <table>
              <tbody>
                {data.low.map(({ o, r, supply }) => (
                  <tr key={o.id}>
                    <td><Link href={`/residents/${r.id}?tab=orders`}><b>{r.firstName} {r.lastName}</b></Link></td>
                    <td>{o.name} {o.strength}</td>
                    <td>
                      {fmtCount(o.countTenths!)} on hand
                      {supply.daysLeft !== null && ` · about ${supply.daysLeft} day${supply.daysLeft === 1 ? "" : "s"}`}{" "}
                      <span className="pill warn">{o.countTenths! <= 0 ? "Out: count it" : "Refill soon"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>Order refills now, then use Add refill on the resident&apos;s Medication orders when they arrive.</p>
        </section>
      )}
      {data.review.length > 0 && (
        <section className="card" style={{ borderColor: "var(--crit)" }} aria-labelledby="rev-h">
          <h2 id="rev-h">Readings to review</h2>
          <div className="tablewrap">
            <table>
              <tbody>
                {data.review.map(({ v, r, by }) => (
                  <tr key={v.id}>
                    <td><Link href={`/residents/${r.id}?tab=vitals`}><b>{r.firstName} {r.lastName}</b></Link><br /><span className="small muted">{v.recordedAt.toLocaleString("en-US", { timeZone: data.homes.find((h) => h.id === r.facilityId)?.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })} · {by}</span></td>
                    <td>BP {v.systolic}/{v.diastolic} · pulse {v.pulse}{v.tempTenthsF != null ? ` · ${(v.tempTenthsF / 10).toFixed(1)} °F` : ""}{v.oxygen != null ? ` · O2 ${v.oxygen}%` : ""}{v.bloodSugar != null ? ` · sugar ${v.bloodSugar} mg/dL` : ""}<br /><span className="pill crit">Check {v.flags.join(", ")}</span></td>
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
