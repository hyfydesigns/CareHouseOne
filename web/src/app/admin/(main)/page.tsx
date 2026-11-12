import Link from "next/link";
import { getDb } from "@/db/client";
import { cents } from "@/lib/billing-cycle";
import { contractIsDraft } from "@/lib/contract-text";
import { dashboard } from "@/server/admin";

export default async function AdminHome() {
  const d = await dashboard(await getDb());
  return (
    <>
      <div>
        <h1>Overview</h1>
        <p className="muted">Clients, billing, contracts and leads. Resident information is never shown here.</p>
      </div>
      <section className="card">
        <div className="kpis">
          <div><span className="small muted">Clients</span><br /><b>{d.clients}</b><br /><span className="small muted">{d.billed} billed</span></div>
          <div><span className="small muted">Monthly at today&apos;s prices</span><br /><b>{cents(d.monthlyCents)}</b><br /><span className="small muted">homes now × this cycle&apos;s price</span></div>
          <div><span className="small muted">Unpaid invoices</span><br /><b>{cents(d.owedCents)}</b><br /><Link className="small" href="/admin/billing?show=late">{d.lateCount} late</Link></div>
          <div><span className="small muted">Waiting for a signature</span><br /><b>{d.awaitingSignature}</b><br /><Link className="small" href="/admin/contracts">Contracts</Link></div>
          <div><span className="small muted">New demo requests</span><br /><b>{d.newLeads}</b><br /><Link className="small" href="/admin/leads">Leads</Link></div>
        </div>
      </section>
      {contractIsDraft() && (
        <p className="notice" role="note" style={{ margin: 0 }}>
          The contract text is still the draft Terms of Service and BAA, with blanks in [brackets] for the lawyer. Use contracts for testing until the final text is in.
        </p>
      )}
      <div className="row">
        <Link className="btn primary" href="/admin/clients/new">Add a client</Link>
        <Link className="btn" href="/admin/clients">All clients</Link>
      </div>
    </>
  );
}
