import { asc } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { facilities } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { buildReport, canViewReports, isReportKind, MAX_REPORT_DAYS, reportRanges, REPORTS, type ReportKind } from "@/server/reports";
import { MonthEnd } from "./month-end";
import { ReportView } from "./report-view";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ r?: string; home?: string; from?: string; to?: string; m?: string }> }) {
  const me = await requireUser();
  if (!canViewReports(me)) redirect("/dashboard");
  const sp = await searchParams;
  const monthEnd = sp.r === "month-end";
  const kind: ReportKind = isReportKind(sp.r) ? sp.r : "medication";
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const db = await getDb();
  const homes = await withTenant(db, me.orgId, (tx) => tx.select().from(facilities).orderBy(asc(facilities.name)));
  const ranges = reportRanges(localDate(now, homes[0]?.timeZone ?? "America/Chicago"));
  const home = homes.find((h) => h.id === sp.home)?.id;
  const from = sp.from ?? ranges.thisMonth.from;
  const to = sp.to ?? ranges.thisMonth.to;
  const report = monthEnd ? null : await withTenant(db, me.orgId, (tx) => buildReport(tx, actor, kind, { facilityId: home, from, to }, now));
  const qs = (over: Record<string, string>) => new URLSearchParams({ r: kind, ...(home && { home }), from, to, ...over }).toString();
  return (
    <>
      <div>
        <h1>Reports</h1>
        <p className="muted" style={{ margin: 0 }}>{monthEnd ? "Each resident's full record for a month, to print, save as PDF and sign." : REPORTS[kind].blurb}</p>
      </div>
      <nav className="chips" aria-label="Reports">
        {(Object.keys(REPORTS) as ReportKind[]).map((k) => (
          <Link key={k} className="chip" href={`/reports?${qs({ r: k })}`} aria-current={!monthEnd && k === kind ? "page" : undefined}>{REPORTS[k].title}</Link>
        ))}
        <Link className="chip" href={`/reports?r=month-end${home ? `&home=${home}` : ""}`} aria-current={monthEnd ? "page" : undefined}>Month-end records</Link>
      </nav>
      {monthEnd ? (
        <MonthEnd orgId={me.orgId} actor={actor} homes={homes} sp={sp} now={now} />
      ) : (
      <>
      <form className="card" method="get" action="/reports">
        <input type="hidden" name="r" value={kind} />
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
          <Link className="chip" href={`/reports?${qs(ranges.thisMonth)}`}>This month</Link>
          <Link className="chip" href={`/reports?${qs(ranges.lastMonth)}`}>Last month</Link>
          <Link className="chip" href={`/reports?${qs(ranges.last30)}`}>Last 30 days</Link>
        </div>
      </form>
      {!report ? (
        <p className="error">Choose a start date on or before the end date, at most {MAX_REPORT_DAYS} days apart.</p>
      ) : (
        <>
          <div className="row">
            <h2 style={{ margin: 0 }}>{report.title} · {report.homes} · {report.from} to {report.to}</h2>
            <span className="spacer" />
            <Link className="btn small" href={`/print/reports?${qs({})}`}>Print or save as PDF</Link>
            <a className="btn small" href={`/api/reports?${qs({})}`}>Download spreadsheet (CSV)</a>
          </div>
          <ReportView report={report} />
          <p className="small muted" style={{ margin: 0 }}>Reports hold residents&apos; health information. Printing and downloading are recorded in the audit log.</p>
        </>
      )}
      </>
      )}
    </>
  );
}
