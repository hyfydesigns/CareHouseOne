"use server";

import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { canViewReports, isReportKind } from "@/server/reports";
import { getResident } from "@/server/residents";

/**
 * Audits printing (or saving as PDF) a resident's record, from the Print button. Rendering the
 * page never writes: in development a database write reloads the page, which would loop.
 */
export async function recordPrintedAction(residentId: string, month: string, sections: string[]): Promise<void> {
  const me = await requireUser();
  if (!canManageCare(me)) return;
  await withTenant(await getDb(), me.orgId, async (tx) => {
    const r = await getResident(tx, me, residentId);
    if (!r) return;
    await audit(tx, { orgId: r.orgId, actorId: me.id, action: "record_printed", entity: "resident", entityId: r.id, details: { month, sections: sections.slice(0, 4) } });
  });
}

/** Audits printing (or saving as PDF) a report, from the Print button. */
export async function recordReportPrintedAction(kind: string, q: { facilityId?: string; from: string; to: string }): Promise<void> {
  const me = await requireUser();
  if (!canViewReports(me) || !isReportKind(kind)) return;
  await withTenant(await getDb(), me.orgId, (tx) =>
    audit(tx, { orgId: me.orgId, actorId: me.id, action: "report_printed", entity: "organization", entityId: me.orgId, details: { report: kind, facilityId: q.facilityId, from: q.from, to: q.to } }),
  );
}
