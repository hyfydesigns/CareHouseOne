import Link from "next/link";
import { getDb } from "@/db/client";
import { cents, dayIn, showDay } from "@/lib/billing-cycle";
import { listClients } from "@/server/admin";

export default async function ClientsPage() {
  const rows = await listClients(await getDb());
  return (
    <>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>Clients</h1>
        <Link className="btn primary" href="/admin/clients/new">Add a client</Link>
      </div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Client</th><th>Setup</th><th>Billing</th><th>Unpaid</th><th>Contract</th><th>Last sign-in</th></tr>
            </thead>
            <tbody>
              {rows.length ? (
                rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/admin/clients/${c.id}`}><b>{c.name}</b></Link>
                      <br />
                      <span className="small muted">since {showDay(dayIn(c.createdAt), true)}</span>
                    </td>
                    <td className="small">
                      {c.homes} home{c.homes === 1 ? "" : "s"} · {c.staff} staff{c.invited ? ` (+${c.invited} invited)` : ""} · {c.tablets} tablet{c.tablets === 1 ? "" : "s"}
                      <br />
                      {c.ownerStatus === "active" ? <span className="pill ok">Owner signed in</span> : c.ownerStatus === "invited" ? <span className="pill warn">Owner invited</span> : <span className="pill crit">No owner</span>}
                    </td>
                    <td>
                      {c.method ? <span className={`pill ${c.billing.tone}`}>{c.billing.label}</span> : <span className="pill mute">Not billed</span>}
                      <br />
                      <span className="small muted">{c.method === "invoice" ? "PayPal invoice" : c.method === "paypal" ? "PayPal subscription" : ""}</span>
                    </td>
                    <td>{c.owed ? <span className={c.late ? "pill crit" : undefined}>{cents(c.owed)}{c.late ? " late" : ""}</span> : <span className="muted">—</span>}</td>
                    <td>{c.contract === "signed" ? <span className="pill ok">Signed</span> : c.contract === "sent" ? <span className="pill warn">Sent</span> : <span className="pill mute">None</span>}</td>
                    <td className="small">{c.lastSignInAt ? showDay(dayIn(c.lastSignInAt), true) : "Never"}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={6} className="muted">No clients yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
