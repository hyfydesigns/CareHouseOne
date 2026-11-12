import Link from "next/link";
import { getDb } from "@/db/client";
import { dayIn, showDay } from "@/lib/billing-cycle";
import { LEAD_STATUSES, listLeads } from "@/server/admin";
import { leadAction } from "../../actions";
import { ActionForm } from "../../forms";

const LABEL: Record<string, string> = { new: "New", contacted: "Contacted", won: "Won", lost: "Lost" };
const TONE: Record<string, string> = { new: "info", contacted: "warn", won: "ok", lost: "mute" };

export default async function LeadsPage() {
  const rows = await listLeads(await getDb());
  return (
    <>
      <div>
        <h1>Leads</h1>
        <p className="muted">Demo requests from the website, newest first.</p>
      </div>
      {rows.length ? (
        rows.map((l) => (
          <section className="card" key={l.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <b>{l.organization}</b> <span className={`pill ${TONE[l.status] ?? "mute"}`}>{LABEL[l.status] ?? l.status}</span>
                <br />
                <span className="small">{l.name} · <a href={`mailto:${l.email}`}>{l.email}</a></span>
                <br />
                <span className="small muted">
                  {showDay(dayIn(l.createdAt), true)}
                  {l.homes ? ` · ${l.homes} home${l.homes === 1 ? "" : "s"}` : ""}
                  {l.residents ? ` · ${l.residents} residents` : ""}
                </span>
              </div>
              {l.orgId ? <Link className="btn small" href={`/admin/clients/${l.orgId}`}>Open client</Link> : <Link className="btn small primary" href={`/admin/clients/new?lead=${l.id}`}>Make a client</Link>}
            </div>
            {l.message && <p className="small" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{l.message}</p>}
            <details>
              <summary>Status and notes</summary>
              <ActionForm action={leadAction.bind(null, l.id)} submit="Save">
                <div className="field">
                  <label htmlFor={`st-${l.id}`}>Status</label>
                  <select id={`st-${l.id}`} name="status" defaultValue={l.status} style={{ maxWidth: 200 }}>
                    {LEAD_STATUSES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor={`nt-${l.id}`}>Notes</label>
                  <textarea id={`nt-${l.id}`} name="notes" rows={3} maxLength={2000} defaultValue={l.notes ?? ""} />
                </div>
              </ActionForm>
            </details>
          </section>
        ))
      ) : (
        <section className="card"><p className="muted" style={{ margin: 0 }}>No demo requests yet.</p></section>
      )}
    </>
  );
}
