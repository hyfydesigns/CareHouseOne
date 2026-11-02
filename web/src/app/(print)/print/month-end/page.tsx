import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { residentsForMonth } from "@/server/reports";
import { visibleFacilities } from "@/server/residents";
import { monthFrom } from "../../../(app)/care/month";
import { recordMonthEndPrintedAction } from "../actions";
import { PrintButton } from "../print-button";
import { loadResidentMonth, ResidentMonth, SECTION_LABELS, sectionsFrom, type Section } from "../resident-month";

/**
 * Month end: every resident of one home for one month, each starting on a new page, so the whole
 * home prints (or saves as one PDF) in one go. Owners and admins only; audited per resident.
 */
export default async function PrintMonthEnd({ searchParams }: { searchParams: Promise<{ home?: string; m?: string; only?: string }> }) {
  const me = await requireUser();
  if (!canManageCare(me)) redirect("/dashboard");
  const sp = await searchParams;
  const show = sectionsFrom(sp.only);
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const home = (await visibleFacilities(tx, me)).find((h) => h.id === sp.home);
    if (!home) return null;
    const m = monthFrom(sp.m, localDate(now, home.timeZone));
    const records = [];
    for (const r of await residentsForMonth(tx, me, home.id, m.year, m.month)) records.push(await loadResidentMonth(tx, me, r, m, show, now));
    return { home, m, records };
  });
  if (!data) redirect("/reports?r=month-end");
  const { home, m, records } = data;
  const ym = `${m.year}-${String(m.month).padStart(2, "0")}`;
  const url = (over: { m?: string; only?: string }) => `/print/month-end?${new URLSearchParams({ home: home.id, m: over.m ?? ym, ...((over.only ?? sp.only) && { only: over.only ?? sp.only! }) })}`;
  const toggle = (s: Section) => {
    const next = new Set(show);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    return url({ only: [...next].join(",") || "mar" });
  };
  return (
    <main className="print-page">
      <div className="no-print row" style={{ gap: 8 }}>
        <Link className="btn small" href={`/reports?r=month-end&home=${home.id}&m=${ym}`}>‹ Back to reports</Link>
        <Link className="btn small" href={url({ m: m.prev })}>‹ {m.prevLabel}</Link>
        {m.next && <Link className="btn small" href={url({ m: m.next })}>{m.nextLabel} ›</Link>}
        <span className="spacer" />
        {SECTION_LABELS.map(([k, l]) => (
          <Link key={k} className={`btn small ${show.has(k) ? "primary" : ""}`} href={toggle(k)}>{l}</Link>
        ))}
        {records.length > 0 && <PrintButton record={recordMonthEndPrintedAction.bind(null, home.id, ym, [...show])} />}
      </div>
      <p className="no-print small muted" style={{ margin: 0 }}>
        {home.name} · {m.label} · {records.length} resident{records.length === 1 ? "" : "s"}, each on its own pages. To save one PDF, choose <b>Save as PDF</b> as the printer.
      </p>
      {records.length ? records.map((d) => (
        <div key={d.r.id} className="print-resident">
          <ResidentMonth data={d} />
        </div>
      )) : <p>No residents lived at {home.name} in {m.label}.</p>}
    </main>
  );
}
