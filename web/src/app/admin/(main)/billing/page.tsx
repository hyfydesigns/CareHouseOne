import Link from "next/link";
import { getDb } from "@/db/client";
import { cents, CYCLE_DAY, dayIn, DUE_DAY, LATE_DAY, showDay, showPeriod } from "@/lib/billing-cycle";
import { allInvoices } from "@/server/admin";
import { invoiceNumber } from "@/server/billing";
import { invoiceAction } from "../../actions";
import { ActionButton } from "../../forms";

const FILTERS = { open: "Unpaid", late: "Late", all: "All" } as const;

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const filter = show === "late" || show === "all" ? show : "open";
  const rows = await allInvoices(await getDb(), filter);
  const path = "/admin/billing";
  const total = rows.filter((r) => !r.inv.paidAt).reduce((a, r) => a + r.inv.amountCents, 0);
  return (
    <>
      <div>
        <h1>Billing</h1>
        <p className="muted">
          Every client is on the same calendar: cycles run from the {CYCLE_DAY}th to the {CYCLE_DAY}th, invoices go out the next day, payment is due on the {DUE_DAY}th and late on the {LATE_DAY}th.
        </p>
      </div>
      <div className="row" role="group" aria-label="Show">
        {Object.entries(FILTERS).map(([k, label]) => (
          <Link key={k} className={`btn small${filter === k ? " primary" : ""}`} href={`${path}?show=${k}`} aria-current={filter === k ? "page" : undefined}>{label}</Link>
        ))}
        {filter !== "all" && <span className="muted small">{rows.length} invoice{rows.length === 1 ? "" : "s"}, {cents(total)}</span>}
      </div>
      <section className="card">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Client</th><th>Invoice</th><th>Period</th><th>Amount</th><th>Due</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.length ? (
                rows.map(({ inv: i, org, method }) => (
                  <tr key={i.id}>
                    <td><Link href={`/admin/clients/${i.orgId}`}>{org}</Link><br /><span className="small muted">{method === "invoice" ? "PayPal invoice" : "PayPal subscription"}</span></td>
                    <td>{invoiceNumber(i)}</td>
                    <td className="small">{showPeriod({ start: i.periodStart, end: i.periodEnd })}</td>
                    <td><b>{cents(i.amountCents)}</b>{i.lateFeeCents > 0 && <span className="small muted"><br />+ {cents(i.lateFeeCents)} late fee</span>}</td>
                    <td>{showDay(i.dueOn, true)}</td>
                    <td>{i.paidAt ? <span className="pill ok">Paid {showDay(dayIn(i.paidAt))}</span> : i.lateAt ? <span className="pill crit">Late</span> : <span className="pill mute">Due</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 6 }}>
                        {!i.paidAt && <ActionButton action={invoiceAction.bind(null, i.id, "paid", path)} label="Mark paid" ask="Mark this invoice paid. How was it paid (for the record)? If it's a PayPal invoice, mark it paid in PayPal too." />}
                        {!i.paidAt && i.paypalInvoiceId && <ActionButton action={invoiceAction.bind(null, i.id, "remind", path)} label="Remind" confirmText="Have PayPal email the client a reminder?" />}
                        {i.lateFeeCents > 0 && <ActionButton action={invoiceAction.bind(null, i.id, "waive", path)} label="Waive late fee" confirmText="Waive the late fee? Its PayPal invoice is cancelled and the client is told." />}
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={7} className="muted">{filter === "all" ? "No invoices yet." : "Nothing outstanding."}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
