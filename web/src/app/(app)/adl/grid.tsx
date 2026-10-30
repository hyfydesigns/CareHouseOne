import { ADL_ACTIVITIES, SUPPORT_LEVELS, type AdlActivity, type AdlMonth } from "@/server/adl";

/** A month of ADLs: one row per activity, one column per day, the most help given that day. */
export function AdlGrid({ month, className = "grid-mar" }: { month: AdlMonth; className?: string }) {
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: month.tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <>
      <div className="tablewrap">
        <table className={className}>
          <thead>
            <tr>
              <th>Activity</th>
              {Array.from({ length: month.days }, (_, i) => <th key={i} className="d">{i + 1}</th>)}
            </tr>
          </thead>
          <tbody>
            {(Object.keys(ADL_ACTIVITIES) as AdlActivity[]).map((a) => (
              <tr key={a}>
                <td><b>{ADL_ACTIVITIES[a]}</b></td>
                {month.grid[a].map((s, i) => (
                  <td key={i} className={`d adl-${s ?? "none"}`} title={s ? SUPPORT_LEVELS[s].label : undefined}>{s ? SUPPORT_LEVELS[s].letter : ""}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {Object.values(SUPPORT_LEVELS).map((l) => `${l.letter} = ${l.label.toLowerCase()}`).join(" · ")}. When help was recorded more than once in a day, the most help given is shown.
      </p>
      {month.notes.length > 0 && (
        <ul className="stack" style={{ margin: 0, paddingLeft: 18, gap: 4 }}>
          {month.notes.map((n, i) => (
            <li key={i} className="small">
              <b>{when(n.at)}</b> · {ADL_ACTIVITIES[n.activity]}: {SUPPORT_LEVELS[n.support].label.toLowerCase()} · {n.note}
              {n.by && <span className="muted"> ({n.by})</span>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
