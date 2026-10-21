import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { localDate, localTime } from "@/lib/time";
import { SHIFT_LABEL, shiftHomes, shiftStatus } from "@/server/care";
import { SAFETY_KINDS, safetyLog, safetyStatus, type SafetyKind } from "@/server/operations";
import { visibleFacilities } from "@/server/residents";
import { safetyAction } from "../ops-actions";
import { SafetyCheckForm } from "../ops-forms";

const DAY = 86_400_000;

export default async function SafetyPage() {
  const me = await requireUser();
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await visibleFacilities(tx, me);
    const status = await Promise.all(homes.map(async (h) => ({ home: h, checks: await safetyStatus(tx, me, h.id, now) })));
    const log = await safetyLog(tx, me, homes.map((h) => h.id), new Date(now.getTime() - 365 * DAY));
    const shiftHome = (await shiftStatus(tx, me))?.facilityId ?? shiftHomes(me, me.device?.facilityIds)[0];
    return { homes, status, log, shiftHome };
  });
  if (!data.homes.length) return <p className="muted">You&apos;re not assigned to a home yet. Ask your manager.</p>;
  const tzOf = (id: string) => data.homes.find((h) => h.id === id)?.timeZone ?? "America/Chicago";
  const day = (d: Date, tz: string) => d.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" });
  const when = (d: Date, tz: string) => d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <>
      <div>
        <h1>Fire drills and safety checks</h1>
        <p className="muted">Monthly fire drills, rotated so each shift drills at least every three months, plus monthly smoke detector and extinguisher checks. Check your state&apos;s rules.</p>
      </div>
      <div className="homes">
        {data.status.map(({ home, checks }) => (
          <section className="card" key={home.id}>
            <h2 style={{ margin: 0 }}>{home.name}</h2>
            <ul className="stack" style={{ margin: 0, paddingLeft: 0, listStyle: "none" }}>
              {checks.map((c) => (
                <li key={c.kind} className="row" style={{ gap: 8 }}>
                  <span className={`pill ${c.overdue ? "crit" : "ok"}`}>{c.overdue ? "Due" : "Done"}</span>
                  <span>{c.label}</span>
                  <span className="small muted">{c.last ? `last ${day(c.last, home.timeZone)}` : "never recorded"}</span>
                  {c.shiftsMissing.length > 0 && <span className="small muted">· no {c.shiftsMissing.map((s) => SHIFT_LABEL[s].toLowerCase()).join(", ")} shift drill in 3 months</span>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
      <SafetyCheckForm
        action={safetyAction}
        homes={data.homes.map((h) => ({ id: h.id, name: h.name, today: localDate(now, h.timeZone), now: localTime(now, h.timeZone) }))}
        kinds={(Object.keys(SAFETY_KINDS) as SafetyKind[]).map((k) => [k, SAFETY_KINDS[k].label])}
        defaultHome={data.homes.find((h) => h.id === data.shiftHome)?.id ?? data.homes[0].id}
      />
      <section className="card">
        <h2>The last 12 months</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Home</th><th>What</th><th>Shift</th><th>Details</th><th>By</th></tr></thead>
            <tbody>
              {data.log.length ? data.log.map(({ c, by }) => (
                <tr key={c.id}>
                  <td>{when(c.performedAt, tzOf(c.facilityId))}</td>
                  <td>{data.homes.find((h) => h.id === c.facilityId)?.name}</td>
                  <td>{SAFETY_KINDS[c.kind as SafetyKind]?.label ?? c.kind}</td>
                  <td>{c.shift ? SHIFT_LABEL[c.shift] : ""}</td>
                  <td>
                    {[c.participants != null && `${c.participants} residents`, c.durationMinutes != null && `${c.durationMinutes} min to evacuate`].filter(Boolean).join(" · ")}
                    {c.issues && <div className="small" style={{ whiteSpace: "pre-wrap" }}>{c.issues}</div>}
                  </td>
                  <td>{by}</td>
                </tr>
              )) : <tr><td colSpan={6} className="muted">Nothing recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
