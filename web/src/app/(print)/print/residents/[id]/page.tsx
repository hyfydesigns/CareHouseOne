import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities } from "@/db/schema";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { getResident } from "@/server/residents";
import { monthFrom } from "../../../../(app)/care/month";
import { recordPrintedAction } from "../../actions";
import { PrintButton } from "../../print-button";
import { loadResidentMonth, ResidentMonth, SECTION_LABELS, sectionsFrom, type Section } from "../../resident-month";

/** One resident's month on paper. Owners and admins only; every print is audited. */
export default async function PrintResident({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ m?: string; only?: string }> }) {
  const me = await requireUser();
  if (!canManageCare(me)) redirect("/dashboard");
  const { id } = await params;
  const sp = await searchParams;
  const show = sectionsFrom(sp.only);
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const r = await getResident(tx, me, id);
    if (!r) return null;
    const [home] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, r.facilityId));
    return loadResidentMonth(tx, me, r, monthFrom(sp.m, localDate(now, home.tz)), show, now);
  });
  if (!data) notFound();
  const { r, m } = data;
  const toggle = (s: Section) => {
    const next = new Set(show);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    return `/print/residents/${r.id}?m=${m.year}-${String(m.month).padStart(2, "0")}&only=${[...next].join(",") || "mar"}`;
  };
  const monthKey = (k: string) => `/print/residents/${r.id}?m=${k}${sp.only ? `&only=${sp.only}` : ""}`;
  return (
    <main className="print-page">
      <div className="no-print row" style={{ gap: 8 }}>
        <Link className="btn small" href={`/residents/${r.id}`}>‹ Back to {r.firstName}</Link>
        <Link className="btn small" href={monthKey(m.prev)}>‹ {m.prevLabel}</Link>
        {m.next && <Link className="btn small" href={monthKey(m.next)}>{m.nextLabel} ›</Link>}
        <span className="spacer" />
        {SECTION_LABELS.map(([k, l]) => (
          <Link key={k} className={`btn small ${show.has(k) ? "primary" : ""}`} href={toggle(k)}>{l}</Link>
        ))}
        <PrintButton record={recordPrintedAction.bind(null, r.id, `${m.year}-${String(m.month).padStart(2, "0")}`, [...show])} />
      </div>
      <ResidentMonth data={data} />
    </main>
  );
}
