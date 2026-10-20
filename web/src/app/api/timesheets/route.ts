import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { currentUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { canViewTimesheets, timesheet, timesheetCsv } from "@/server/timesheets";

/** Timesheet download for payroll. Owners and admins only; every download is in the audit log. */
export async function GET(request: Request) {
  const me = await currentUser();
  if (!me || me.locked || me.needsPin || !canViewTimesheets(me)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const url = new URL(request.url);
  const q = { facilityId: url.searchParams.get("home") || undefined, from: url.searchParams.get("from") ?? "", to: url.searchParams.get("to") ?? "" };
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const t = await withTenant(await getDb(), me.orgId, async (tx) => {
    const sheet = await timesheet(tx, actor, q, new Date());
    if (sheet) await audit(tx, { orgId: me.orgId, actorId: me.id, action: "timesheet_downloaded", entity: "organization", entityId: me.orgId, details: q });
    return sheet;
  });
  if (!t) return NextResponse.json({ error: "Choose a valid date range." }, { status: 400 });
  return new NextResponse(timesheetCsv(t), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="timesheet-${t.from}-to-${t.to}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
