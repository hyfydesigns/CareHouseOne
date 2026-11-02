import type { Report } from "@/server/reports";

/** A report's summary tiles and tables, the same on the page and on paper. */
export function ReportView({ report }: { report: Report }) {
  return (
    <>
      {report.tiles.length > 0 && (
        <div className="stat-row report-tiles">
          {report.tiles.map((t) => (
            <span key={t.label} className={`stat ${t.tone ?? ""}`}><b>{t.value}</b><span>{t.label}</span></span>
          ))}
        </div>
      )}
      {report.tables.map((t) => (
        <section key={t.title} className="card report-table" aria-label={t.title}>
          <h2>{t.title}</h2>
          <div className="tablewrap">
            <table>
              <thead><tr>{t.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {t.rows.length ? (
                  t.rows.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{j === 0 ? <b>{cell ?? "—"}</b> : cell ?? "—"}</td>)}</tr>)
                ) : (
                  <tr><td colSpan={t.columns.length} className="muted">{t.empty}</td></tr>
                )}
              </tbody>
            </table>
          </div>
          {t.note && <p className="small muted" style={{ margin: 0 }}>{t.note}</p>}
        </section>
      ))}
    </>
  );
}
