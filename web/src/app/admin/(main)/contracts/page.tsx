import Link from "next/link";
import { getDb } from "@/db/client";
import { dayIn, showDay } from "@/lib/billing-cycle";
import { allContracts } from "@/server/admin";
import { contractAction } from "../../actions";
import { ActionButton } from "../../forms";

const when = (d: Date | null) => (d ? showDay(dayIn(d), true) : "—");

export default async function ContractsPage() {
  const rows = await allContracts(await getDb());
  const path = "/admin/contracts";
  return (
    <>
      <div>
        <h1>Contracts</h1>
        <p className="muted">Send a contract from a client&apos;s page. The signer gets a private link, signs online, and you both get the signed PDF.</p>
      </div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Client</th><th>Signer</th><th>Sent</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length ? (
                rows.map(({ c, org }) => (
                  <tr key={c.id}>
                    <td><Link href={`/admin/clients/${c.orgId}`}>{org}</Link></td>
                    <td>{c.signerName}<br /><span className="small muted">{c.signerEmail}</span></td>
                    <td>{when(c.sentAt)}{c.remindedAt && <span className="small muted"><br />resent {when(c.remindedAt)}</span>}</td>
                    <td>
                      {c.status === "signed" ? (
                        <span className="pill ok">Signed {when(c.signedAt)}</span>
                      ) : c.status === "void" ? (
                        <span className="pill mute">Withdrawn</span>
                      ) : c.expiresAt < new Date() ? (
                        <span className="pill crit">Link expired</span>
                      ) : (
                        <span className="pill warn">{c.viewedAt ? `Opened ${when(c.viewedAt)}` : "Not opened yet"}</span>
                      )}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <a className="btn small" href={`/admin/contracts/${c.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                        {c.status === "sent" && <ActionButton action={contractAction.bind(null, c.id, "remind", path)} label="Resend" confirmText="Email the signer a new link (another 30 days)?" />}
                        {c.status === "sent" && <ActionButton action={contractAction.bind(null, c.id, "void", path)} label="Withdraw" confirmText="Withdraw this contract? Its link stops working." />}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={5} className="muted">No contracts sent yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
