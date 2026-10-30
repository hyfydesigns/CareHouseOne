import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { localClock } from "@/lib/time";
import { ADL_ACTIVITIES, currentShiftAdl, SUPPORT_LEVELS, type AdlActivity } from "@/server/adl";
import { listResidents } from "@/server/residents";
import { ResidentPicker } from "../care/resident-picker";
import { adlAction } from "./actions";
import { AdlForm } from "./form";

export default async function AdlPage({ searchParams }: { searchParams: Promise<{ r?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const rs = await listResidents(tx, me);
    const r = rs.find((x) => x.id === sp.r) ?? rs[0];
    return { rs, r, shift: r ? await currentShiftAdl(tx, r, now) : null };
  });
  const { rs, r, shift } = data;
  return (
    <>
      <h1>Daily care (ADLs)</h1>
      <ResidentPicker residents={rs} current={r?.id} base="/adl" />
      {r && shift ? (
        <>
          <AdlForm
            action={adlAction}
            residentId={r.id}
            firstName={r.firstName}
            shift={shift.shift}
            activities={Object.entries(ADL_ACTIVITIES)}
            levels={Object.entries(SUPPORT_LEVELS).map(([k, v]) => [k, v.label])}
            current={Object.fromEntries([...shift.latest].map(([a, v]) => [a, v.support]))}
          />
          <section className="card">
            <div className="row">
              <h2 style={{ margin: 0 }}>Recorded this shift</h2>
              <span className="spacer" />
              <Link className="btn small" href={`/residents/${r.id}?tab=adl`}>Month view</Link>
            </div>
            {shift.latest.size ? (
              <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 6 }}>
                {[...shift.latest].map(([a, v]) => (
                  <li key={a}>
                    <b>{ADL_ACTIVITIES[a as AdlActivity]}:</b> {SUPPORT_LEVELS[v.support].label}
                    <span className="small muted"> · {v.by ?? "Unknown"}, {localClock(v.at, shift.tz)}</span>
                    {v.note && <div className="small">{v.note}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted" style={{ margin: 0 }}>Nothing yet this shift.</p>
            )}
          </section>
        </>
      ) : (
        <p className="muted">No residents yet.</p>
      )}
    </>
  );
}
