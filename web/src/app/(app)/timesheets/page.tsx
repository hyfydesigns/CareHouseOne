import { asc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { facilities } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { addDays } from "@/lib/time";
import { canViewTimesheets, MAX_RANGE_DAYS, thisWeek, timesheet } from "@/server/timesheets";

const STATUS = { complete: null, on_shift: <span className="pill ok">On shift</span>, no_sign_out: <span className="pill warn">No sign-out</span> };

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<{ home?: string; from?: string; to?: string }> }) {
  const me = await requireUser();
  if (!canViewTimesheets(me)) redirect("/dashboard");
  const sp = await searchParams;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const db = await getDb();
  const homes = await withTenant(db, me.orgId, (tx) => tx.select().from(facilities).orderBy(asc(facilities.name)));
  const week = thisWeek(now, homes[0]?.timeZone ?? "America/Chicago");
  const home = homes.find((h) => h.id === sp.home)?.id;
  const from = sp.from ?? week.from;
  const to = sp.to ?? week.to;
  const t = await withTenant(db, me.orgId, (tx) => timesheet(tx, actor, { facilityId: home, from, to }, now));
  const qs = (f: string, t2: string) => `/timesheets?${new URLSearchParams({ ...(home && { home }), from: f, to: t2 })}`;
  const lastWeek = { from: addDays(week.from, -7), to: addDays(week.to, -7) };
  return (
    <>
      <div>
        <h1>Timesheets</h1>
        <p className="muted" style={{ margin: 0 }}>From caregivers&apos; sign-ins and sign-outs on the home tablets. Times are in each home&apos;s time zone.</p>
      </div>
      <form className="card" method="get" action="/timesheets">
        <div className="row" style={{ alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="home">Home</label>
            <select id="home" name="home" defaultValue={home ?? ""}>
              <option value="">All homes</option>
              {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: "0 1 170px" }}><label htmlFor="from">From</label><input id="from" name="from" type="date" defaultValue={from} /></div>
          <div className="field" style={{ flex: "0 1 170px" }}><label htmlFor="to">To</label><input id="to" name="to" type="date" defaultValue={to} /></div>
          <button className="btn primary">Show</button>
        </div>
        <div className="chips">
          <Link className="chip" href={qs(week.from, week.to)}>This week</Link>
          <Link className="chip" href={qs(lastWeek.from, lastWeek.to)}>Last week</Link>
          <Link className="chip" href={qs(addDays(week.from, -7), week.to)}>Last 2 weeks</Link>
        </div>
      </form>
      {!t ? (
        <p className="error">Choose a start date on or before the end date, at most {MAX_RANGE_DAYS} days apart.</p>
      ) : (
        <>
          <section className="card" aria-labelledby="tot-h">
            <div className="row">
              <h2 id="tot-h" style={{ margin: 0 }}>Totals · {t.from} to {t.to}</h2>
              <span className="spacer" />
              <a className="btn small" href={`/api/timesheets?${new URLSearchParams({ ...(home && { home }), from: t.from, to: t.to })}`}>Download spreadsheet (CSV)</a>
            </div>
            <div className="tablewrap">
              <table>
                <thead><tr><th>Name</th><th>Shifts</th><th>Hours</th><th></th></tr></thead>
                <tbody>
                  {t.people.length ? (
                    t.people.map((p) => (
                      <tr key={p.userId}>
                        <td><b>{p.name}</b></td>
                        <td>{p.shifts}</td>
                        <td>{p.hours.toFixed(2)}</td>
                        <td>{p.problems > 0 && <span className="pill warn">{p.problems} without a sign-out</span>}</td>
                      </tr>
                    ))
                  ) : (
                    <tr><td colSpan={4} className="muted">No shifts in this period.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {t.people.some((p) => p.problems) && (
              <p className="small muted" style={{ margin: 0 }}>Shifts without a sign-out aren&apos;t counted in the hours. Check them with the caregiver before running payroll.</p>
            )}
          </section>
          {t.shifts.length > 0 && (
            <section className="card" aria-labelledby="sh-h">
              <h2 id="sh-h">Shifts</h2>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Name</th><th>Home</th><th>Date</th><th>In</th><th>Out</th><th>Hours</th><th></th></tr></thead>
                  <tbody>
                    {t.shifts.map((s) => (
                      <tr key={s.id}>
                        <td>{s.name}</td>
                        <td>{s.home}</td>
                        <td>{s.date}</td>
                        <td>{s.signedIn}</td>
                        <td>{s.signedOut ?? "—"}</td>
                        <td>{s.hours == null ? "—" : s.hours.toFixed(2)}</td>
                        <td>{STATUS[s.status]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
