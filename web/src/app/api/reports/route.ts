import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { currentUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { buildReport, canViewReports, isReportKind, reportCsv } from "@/server/reports";

/** A report as a spreadsheet. Owners and admins only; every download is in the audit log. */
export async function GET(request: Request) {
  const me = await currentUser();
  if (!me || me.locked || me.needsPin || !canViewReports(me)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const url = new URL(request.url);
  const kind = url.searchParams.get("r");
  if (!isReportKind(kind)) return NextResponse.json({ error: "Choose a report." }, { status: 400 });
  const q = { facilityId: url.searchParams.get("home") || undefined, from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" };
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const report = await withTenant(await getDb(), me.orgId, async (tx) => {
    const r = await buildReport(tx, actor, kind, q, new Date());
    if (r) await audit(tx, { orgId: me.orgId, actorId: me.id, action: "report_downloaded", entity: "organization", entityId: me.orgId, details: { report: kind, ...q } });
    return r;
  });
  if (!report) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  return new NextResponse(reportCsv(report), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${kind}-report-${report.from}-to-${report.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
