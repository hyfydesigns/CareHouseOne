import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { organizations } from "@/db/schema";
import { requireUser } from "@/lib/session";
import { buildReport, canViewReports, isReportKind } from "@/server/reports";
import { ReportView } from "../../../(app)/reports/report-view";
import { recordReportPrintedAction } from "../actions";
import { PrintButton } from "../print-button";

export default async function PrintReportPage({ searchParams }: { searchParams: Promise<{ r?: string; home?: string; from?: string; to?: string }> }) {
  const me = await requireUser();
  if (!canViewReports(me)) redirect("/dashboard");
  const sp = await searchParams;
  if (!isReportKind(sp.r)) redirect("/reports");
  const q = { facilityId: sp.home || undefined, from: sp.from ?? "", to: sp.to ?? "" };
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => ({
    org: (await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, me.orgId)))[0]?.name ?? "",
    report: await buildReport(tx, me, sp.r as Parameters<typeof buildReport>[2], q, now),
  }));
  if (!data.report) redirect("/reports");
  const r = data.report;
  const back = `/reports?${new URLSearchParams({ r: r.kind, ...(q.facilityId && { home: q.facilityId }), from: r.from, to: r.to })}`;
  return (
    <main className="print-page">
      <div className="no-print row" style={{ gap: 8 }}>
        <Link className="btn small" href={back}>‹ Back to reports</Link>
        <span className="spacer" />
        <PrintButton record={recordReportPrintedAction.bind(null, r.kind, q)} />
      </div>
      <header className="print-head">
        <div>
          <h1>{r.title} report</h1>
          <p>{data.org} · {r.homes}</p>
        </div>
        <div className="print-meta">
          <b>{r.from} to {r.to}</b>
          <span>Printed {now.toISOString().slice(0, 10)}</span>
          <span>Confidential health information</span>
        </div>
      </header>
      <ReportView report={r} />
    </main>
  );
}
