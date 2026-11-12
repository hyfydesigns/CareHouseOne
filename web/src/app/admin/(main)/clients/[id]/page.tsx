import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { addDays, cents, cycleOn, dayIn, showDay, showPeriod } from "@/lib/billing-cycle";
import { contractIsDraft } from "@/lib/contract-text";
import { INTRO_MONTHS } from "@/lib/pricing";
import { clientDetail } from "@/server/admin";
import { finalCycleOf, invoiceBilled, invoiceNumber, scheduleOf } from "@/server/billing";
import { contractDefaults } from "@/server/contracts";
import {
  billingEmailAction,
  cancelBillingAction,
  contractAction,
  invoiceAction,
  refreshPaypalAction,
  resendOwnerInviteAction,
  sendContractAction,
  startBillingAction,
} from "../../../actions";
import { ActionButton, ActionForm } from "../../../forms";

const ROLE: Record<string, string> = { owner: "Owner", admin: "Administrator", manager: "Manager", nurse: "Nurse", med_caregiver: "Med caregiver", caregiver: "Caregiver" };
const when = (d: Date | null) => (d ? showDay(dayIn(d), true) : "—");

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const { id } = await params;
  const { created } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const db = await getDb();
  const c = await clientDetail(db, id);
  if (!c) notFound();
  const defaults = await contractDefaults(db, id);
  const path = `/admin/clients/${id}`;
  const today = dayIn(new Date());
  const schedule = c.sub ? scheduleOf(c.sub) : null;
  const cycle = schedule ? cycleOn(schedule, today) : null;
  const final = c.sub?.cancelledOn ? finalCycleOf(c.sub) : null;
  const owners = c.people.filter((p) => p.role === "owner");
  const billable = !c.sub || c.sub.status === "CANCELLED";
  const firstOfNext = addDays(today, 1);

  return (
    <>
      <div>
        <p className="small" style={{ margin: 0 }}><Link href="/admin/clients">Clients</Link></p>
        <div className="row" style={{ gap: 10 }}>
          <h1 style={{ margin: 0 }}>{c.org.name}</h1>
          {c.sub ? <span className={`pill ${c.billing.tone}`}>{c.billing.label}</span> : <span className="pill mute">Not billed</span>}
        </div>
        <p className="muted small" style={{ margin: 0 }}>Client since {when(c.org.createdAt)}</p>
      </div>
      {created && <p className="notice" role="status">Client created. The owner has an email with a link to set their password.</p>}

      <section className="card" aria-labelledby="setup-h">
        <h2 id="setup-h">Setup</h2>
        <div className="kpis">
          <div><span className="small muted">Homes</span><br /><b>{c.homes.length}</b></div>
          <div><span className="small muted">Staff accounts</span><br /><b>{c.people.filter((p) => p.status === "active").length}</b><br /><span className="small muted">{c.people.filter((p) => p.status === "invited").length} invited</span></div>
          <div><span className="small muted">Tablets</span><br /><b>{c.tablets}</b></div>
          <div><span className="small muted">Residents</span><br /><b>{c.residents}</b></div>
        </div>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Person</th><th>Role</th><th>Status</th><th>Last sign-in</th></tr></thead>
            <tbody>
              {c.people.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}<br /><span className="small muted">{p.email}</span></td>
                  <td>{ROLE[p.role] ?? p.role}</td>
                  <td>
                    <span className={`pill ${p.status === "active" ? "ok" : p.status === "invited" ? "warn" : "mute"}`}>{p.status === "active" ? "Active" : p.status === "invited" ? "Invited" : "Deactivated"}</span>
                    {p.role === "owner" && p.status === "invited" && (
                      <div><ActionButton action={resendOwnerInviteAction.bind(null, id, p.id)} label="Send a new invitation" confirmText={`Email ${p.email} a new link? The old one stops working.`} /></div>
                    )}
                  </td>
                  <td className="small">{when(p.lastSignInAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!owners.some((o) => o.status === "active") && <p className="small muted" style={{ margin: 0 }}>Nothing else happens until the owner sets a password and signs in; then they invite their staff and register tablets.</p>}
        <p className="small" style={{ margin: 0 }}><b>Homes:</b> {c.homes.map((h) => h.name).join(", ") || "none"}</p>
      </section>

      <section className="card" aria-labelledby="billing-h">
        <h2 id="billing-h">Billing</h2>
        {c.sub ? (
          <>
            <div className="kpis">
              <div><span className="small muted">How they pay</span><br /><b>{invoiceBilled(c.sub) ? "PayPal invoice" : "PayPal subscription"}</b><br /><span className="small muted">{c.sub.paypalSubscriptionId ?? c.sub.payerEmail}</span></div>
              <div><span className="small muted">First paid day</span><br /><b>{schedule ? showDay(schedule.trialEndsOn, true) : "—"}</b><br /><span className="small muted">{schedule ? `${schedule.introCycles} more intro month${schedule.introCycles === 1 ? "" : "s"} after the first cycle` : "Older plan"}</span></div>
              <div><span className="small muted">{final ? "Last billing cycle" : "This billing cycle"}</span><br /><b>{final ? showPeriod(final) : cycle ? showPeriod(cycle) : "—"}</b><br /><span className="small muted">{(final ?? cycle) ? `${cents((final ?? cycle)!.perHomeCents)} per home, invoice ${showDay((final ?? cycle)!.invoiceOn)}` : ""}</span></div>
              <div><span className="small muted">Invoices go to</span><br /><b>{c.sub.payerEmail ?? "—"}</b></div>
            </div>
            {c.billing.warning && <p className={c.billing.tone === "crit" ? "error" : "notice"} style={{ margin: 0 }}>{c.billing.warning}</p>}
            <div className="row">
              <ActionButton action={refreshPaypalAction.bind(null, id)} label="Refresh from PayPal" />
            </div>
            {invoiceBilled(c.sub) && !c.sub.cancelledOn && (
              <details>
                <summary>Change where invoices are sent</summary>
                <ActionForm action={billingEmailAction.bind(null, id)} submit="Save">
                  <div className="field"><label htmlFor="billingEmail">Billing email</label><input id="billingEmail" name="billingEmail" type="email" required defaultValue={c.sub.payerEmail ?? ""} /></div>
                </ActionForm>
              </details>
            )}
          </>
        ) : (
          <>
            <p className="small muted" style={{ margin: 0 }}>
              Not billed yet. Either send a contract below (billing by PayPal invoice starts on its terms when it&apos;s signed), or start billing now if they&apos;ve already agreed in writing.
            </p>
            <details>
              <summary>Start billing by PayPal invoice now</summary>
              <ActionForm action={startBillingAction.bind(null, id)} submit="Start billing">
                <div className="field"><label htmlFor="sb-email">Billing email</label><input id="sb-email" name="billingEmail" type="email" required defaultValue={defaults.signerEmail} /></div>
                <div className="field"><label htmlFor="sb-start">First day billed</label><input id="sb-start" name="startsOn" type="date" required defaultValue={firstOfNext} /><span className="small muted">Invoices go out on the 29th for the cycle that just ended, due the 5th.</span></div>
                <div className="field"><label htmlFor="sb-intro">Months at the introductory price</label><input id="sb-intro" name="introMonths" type="number" min={0} max={12} defaultValue={INTRO_MONTHS} style={{ maxWidth: 120 }} /><span className="small muted">After the first, partial month. 0 for the regular price from the start.</span></div>
              </ActionForm>
            </details>
          </>
        )}
        {c.invoices.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Invoice</th><th>Period</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {c.invoices.map((i) => (
                  <tr key={i.id}>
                    <td>{invoiceNumber(i)}<br /><span className="small muted">{i.paypalInvoiceId ? "PayPal invoice" : "Subscription"}</span></td>
                    <td className="small">{showPeriod({ start: i.periodStart, end: i.periodEnd })}</td>
                    <td>{i.homes} × {cents(i.perHomeCents)} = <b>{cents(i.amountCents)}</b>{i.lateFeeCents > 0 && <span className="small muted"><br />+ {cents(i.lateFeeCents)} late fee</span>}</td>
                    <td>{showDay(i.dueOn, true)}</td>
                    <td>{i.paidAt ? <span className="pill ok">Paid {when(i.paidAt)}</span> : i.lateAt ? <span className="pill crit">Late</span> : <span className="pill mute">Due</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {!i.paidAt && <ActionButton action={invoiceAction.bind(null, i.id, "paid", path)} label="Mark paid" ask="Mark this invoice paid. How was it paid (for the record)? If it's a PayPal invoice, mark it paid in PayPal too." />}
                        {!i.paidAt && i.paypalInvoiceId && <ActionButton action={invoiceAction.bind(null, i.id, "remind", path)} label="Remind" confirmText="Have PayPal email the client a reminder?" />}
                        {i.lateFeeCents > 0 && <ActionButton action={invoiceAction.bind(null, i.id, "waive", path)} label="Waive late fee" confirmText="Waive the late fee? Its PayPal invoice is cancelled and the client is told." />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {c.sub && !c.sub.cancelledOn && c.sub.status !== "CANCELLED" && (
          <details>
            <summary>Cancel billing</summary>
            <p className="small muted">
              {invoiceBilled(c.sub) ? "Stops future invoices." : "Cancels their PayPal subscription."} The billing cycle running today is the last one billed (as a PayPal invoice), and the app keeps working until it ends. The client is emailed.
            </p>
            <ActionForm action={cancelBillingAction.bind(null, id)} submit="Cancel billing" danger>
              <div className="field"><label htmlFor="cb-reason">Reason (for the record)</label><input id="cb-reason" name="reason" maxLength={200} /></div>
              <div className="field"><label htmlFor="cb-confirm">Type &quot;cancel&quot; to confirm</label><input id="cb-confirm" name="confirm" autoComplete="off" required style={{ maxWidth: 160 }} /></div>
            </ActionForm>
          </details>
        )}
      </section>

      <section className="card" aria-labelledby="contracts-h">
        <h2 id="contracts-h">Contracts</h2>
        {c.contracts.length > 0 && (
          <div className="tablewrap">
            <table>
              <thead><tr><th>Sent</th><th>Signer</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {c.contracts.map((k) => (
                  <tr key={k.id}>
                    <td>{when(k.sentAt)}<br /><span className="small muted">{k.version}</span></td>
                    <td>{k.signerName}<br /><span className="small muted">{k.signerEmail}</span></td>
                    <td>
                      {k.status === "signed" ? (
                        <span className="pill ok">Signed {when(k.signedAt)}</span>
                      ) : k.status === "void" ? (
                        <span className="pill mute">Withdrawn</span>
                      ) : k.expiresAt < new Date() ? (
                        <span className="pill crit">Link expired</span>
                      ) : (
                        <span className="pill warn">{k.viewedAt ? `Opened ${when(k.viewedAt)}` : "Not opened yet"}</span>
                      )}
                      {k.status === "signed" && <div className="small muted">by {k.signedName}, {k.signedTitle}</div>}
                    </td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        <a className="btn small" href={`/admin/contracts/${k.id}/pdf`} target="_blank" rel="noreferrer">PDF</a>
                        {k.status === "sent" && <ActionButton action={contractAction.bind(null, k.id, "remind", path)} label="Resend" confirmText="Email the signer a new link (another 30 days)?" />}
                        {k.status === "sent" && <ActionButton action={contractAction.bind(null, k.id, "void", path)} label="Withdraw" confirmText="Withdraw this contract? Its link stops working." />}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <details open={c.contracts.length === 0}>
          <summary>Send a contract to sign</summary>
          {contractIsDraft() && <p className="notice small">The Terms and BAA are still the draft with blanks for the lawyer. Fine for testing; don&apos;t send it to a real client yet.</p>}
          <ActionForm action={sendContractAction.bind(null, id)} submit="Send contract">
            <div className="field"><label htmlFor="sc-name">Signer&apos;s name</label><input id="sc-name" name="signerName" required defaultValue={defaults.signerName} /></div>
            <div className="field"><label htmlFor="sc-email">Signer&apos;s email</label><input id="sc-email" name="signerEmail" type="email" required defaultValue={defaults.signerEmail} /></div>
            <div className="field"><label htmlFor="sc-homes">Homes</label><input id="sc-homes" name="homes" type="number" min={1} max={500} required defaultValue={defaults.homes} style={{ maxWidth: 120 }} /></div>
            {defaults.onPaypal ? (
              <p className="small muted" style={{ margin: 0 }}>They pay through their PayPal subscription, so the order form says so; no billing changes when they sign.</p>
            ) : billable ? (
              <>
                <div className="field"><label htmlFor="sc-start">First day billed</label><input id="sc-start" name="startsOn" type="date" required defaultValue={firstOfNext} /><span className="small muted">Billing by PayPal invoice starts on this day when they sign.</span></div>
                <div className="field"><label htmlFor="sc-intro">Months at the introductory price</label><input id="sc-intro" name="introMonths" type="number" min={0} max={12} defaultValue={INTRO_MONTHS} style={{ maxWidth: 120 }} /></div>
              </>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>They&apos;re already billed by PayPal invoice, so a new order form can&apos;t be sent from here.</p>
            )}
            <div className="field"><label htmlFor="sc-note">Other terms (optional, shown on the order form)</label><textarea id="sc-note" name="note" rows={2} maxLength={1000} /></div>
          </ActionForm>
        </details>
      </section>

      <section className="card" aria-labelledby="log-h">
        <h2 id="log-h">Admin activity</h2>
        {c.log.length ? (
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {c.log.map((l) => (
              <li key={l.id}>{l.at.toISOString().replace("T", " ").slice(0, 16)} UTC · {l.action.replaceAll("_", " ")}</li>
            ))}
          </ul>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Nothing yet.</p>
        )}
      </section>
    </>
  );
}
