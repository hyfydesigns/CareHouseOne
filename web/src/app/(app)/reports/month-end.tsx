import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import type { facilities } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { localDate } from "@/lib/time";
import { residentsForMonth } from "@/server/reports";
import { MONTHS, monthFrom } from "../care/month";

type Home = typeof facilities.$inferSelect;

/**
 * Month-end records: pick a home and a month (last month by default), then open each resident's
 * record, or the whole home at once to print or save as one PDF.
 */
export async function MonthEnd({ orgId, actor, homes, sp, now }: { orgId: string; actor: Actor; homes: Home[]; sp: { home?: string; m?: string }; now: Date }) {
  const home = homes.find((h) => h.id === sp.home) ?? homes[0];
  if (!home) return <p className="muted">Add a home first.</p>;
  const current = monthFrom(undefined, localDate(now, home.timeZone));
  const m = monthFrom(sp.m ?? current.prev, localDate(now, home.timeZone));
  const ym = `${m.year}-${String(m.month).padStart(2, "0")}`;
  const months = Array.from({ length: 12 }, (_, i) => {
    const t = current.year * 12 + (current.month - 1) - i;
    const y = Math.floor(t / 12);
    const mo = (t % 12) + 1;
    return { key: `${y}-${String(mo).padStart(2, "0")}`, label: `${MONTHS[mo - 1]} ${y}${i === 0 ? " (so far)" : ""}` };
  });
  const residents = await withTenant(await getDb(), orgId, (tx) => residentsForMonth(tx, actor, home.id, m.year, m.month));
  return (
    <>
      <form className="card" method="get" action="/reports">
        <input type="hidden" name="r" value="month-end" />
        <div className="row" style={{ alignItems: "end" }}>
          <div className="field" style={{ flex: "1 1 180px" }}>
            <label htmlFor="home">Home</label>
            <select id="home" name="home" defaultValue={home.id}>
              {homes.map((h) => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ flex: "0 1 220px" }}>
            <label htmlFor="m">Month</label>
            <select id="m" name="m" defaultValue={ym}>
              {months.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
            </select>
          </div>
          <button className="btn primary">Show</button>
        </div>
      </form>
      <section className="card" aria-labelledby="me-h">
        <div className="row">
          <h2 id="me-h" style={{ margin: 0 }}>{home.name} · {m.label}</h2>
          <span className="spacer" />
          {residents.length > 0 && (
            <Link className="btn primary" href={`/print/month-end?home=${home.id}&m=${ym}`} target="_blank">All residents · one PDF</Link>
          )}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          Each record has the medication administration record, vital signs, daily care, progress notes and incident reports for the month, with a line to sign. Open one, then choose <b>Print or save as PDF</b>.
        </p>
        <div className="tablewrap">
          <table className="fit-sm">
            <thead><tr><th>Resident</th><th className="hide-sm">Room</th><th></th></tr></thead>
            <tbody>
              {residents.length ? residents.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.firstName} {r.lastName}</b>{r.status === "discharged" && <span className="pill" style={{ marginLeft: 6 }}>Discharged {r.dischargedOn}</span>}</td>
                  <td className="hide-sm">{r.room ?? "—"}</td>
                  <td style={{ textAlign: "right" }}><Link className="btn small" href={`/print/residents/${r.id}?m=${ym}`} target="_blank">Open record</Link></td>
                </tr>
              )) : <tr><td colSpan={3} className="muted">No residents lived at {home.name} in {m.label}.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <p className="small muted" style={{ margin: 0 }}>Records hold residents&apos; health information. Each print or PDF is recorded in the audit log for every resident in it.</p>
    </>
  );
}
