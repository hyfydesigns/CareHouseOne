import { redirect } from "next/navigation";
import { REMINDER_TIMES } from "@/server/org";
import { getDb, withTenant } from "@/db/client";
import { canViewAudit } from "@/lib/permissions";
import { currentDevice, requireUser } from "@/lib/session";
import { asc } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { billingState, finalCycleOf, invoiceBilled, invoiceNumber, orgInvoices, orgSubscription, scheduleOf } from "@/server/billing";
import { cents, cycleOn, CYCLE_DAY, dayIn, DUE_DAY, LATE_DAY, LATE_FEE, showDay, showPeriod } from "@/lib/billing-cycle";
import { describeBill, INTRO_PRICE_PER_HOME, PRICE_PER_HOME, PRICE_SUMMARY, usd } from "@/lib/pricing";
import { paypalLive } from "@/server/paypal";
import { CONTACT_EMAIL } from "../../(site)/shell";
import { listDevices } from "@/server/devices";
import { canManageHomes, listHomes } from "@/server/homes";
import { listActivities } from "@/server/adl";
import { AddActivityForm, ToggleActivityButton } from "./adl-activities";
import { getOrg, logoDataUrl } from "@/server/org";
import { addActivityAction, addHomeAction, deviceHomesAction, toggleActivityAction, forgetThisDeviceAction, removeHomeAction, updateHomeAction, registerDeviceAction, orgNameAction, residentCheckAction, revokeDeviceAction, appointmentRemindersAction } from "./actions";
import { AddHomeForm, HomeRowView } from "./homes-form";
import { LogoForm } from "./logo-form";
import { DeviceHomesForm, ForgetDeviceButton, RegisterDeviceForm, AppointmentRemindersForm, OrgNameForm, ResidentCheckForm, RevokeDeviceButton } from "./settings-form";

export default async function SettingsPage() {
  const me = await requireUser();
  if (!canViewAudit(me)) redirect("/dashboard");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const data = await withTenant(await getDb(), me.orgId, async (tx) => ({ org: await getOrg(tx, me.orgId), devices: await listDevices(tx, actor), homes: await tx.select().from(facilities).orderBy(asc(facilities.name)),
    sub: await orgSubscription(tx),
    invoices: await orgInvoices(tx),
    homeRows: canManageHomes(me) ? await listHomes(tx) : [],
    activities: await listActivities(tx, { includeHidden: true }),
  }));
  if (!data.org) redirect("/dashboard");
  const here = await currentDevice();
  const tz = data.homes[0]?.timeZone ?? "UTC";
  const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true }) : "—");
  const active = data.devices.filter((r) => !r.d.revokedAt);
  const homeOptions = data.homes.map((h) => ({ id: h.id, name: h.name }));
  const bill = billingState(data.sub);
  // Where the subscription is on the billing calendar: the cycle running today, and the next
  // payment (an invoice that's out and unpaid, or else an estimate for this cycle's homes).
  const today = dayIn(new Date());
  const schedule = data.sub ? scheduleOf(data.sub) : null;
  // Cancelled: only the final cycle is left, until its invoice is out.
  const final = data.sub?.cancelledOn ? finalCycleOf(data.sub) : null;
  const cycle = !schedule ? null : data.sub!.cancelledOn ? (final && today < final.invoiceOn ? final : null) : cycleOn(schedule, today);
  const inTrial = !!schedule && today < schedule.trialEndsOn;
  const unpaid = data.invoices.filter((i) => !i.paidAt).sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0] ?? null;
  const homesNow = Math.max(1, data.homes.length);
  const stageNote = !cycle ? "" : inTrial ? `Free trial until ${showDay(schedule!.trialEndsOn, true)}` : cycle.stage === "regular" ? "Regular price" : "Introductory price";
  const homeCost = !cycle || cycle.stage === "regular" ? usd(PRICE_PER_HOME) : `${usd(INTRO_PRICE_PER_HOME)} (then ${usd(PRICE_PER_HOME)})`;
  const paypalAccount = paypalLive() ? "https://www.paypal.com/myaccount/autopay/" : "https://www.sandbox.paypal.com/myaccount/autopay/";
  return (
    <>
      <div>
        <h1>Settings</h1>
        <p className="muted">{data.org.name}</p>
      </div>
      {me.role === "owner" && <OrgNameForm action={orgNameAction} current={data.org.name} />}
      {canManageHomes(me) && (
        <section className="card" aria-labelledby="homes-h">
          <h2 id="homes-h">Homes</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Home</th><th>Time zone</th><th>Residents</th><th></th></tr></thead>
              <tbody>
                {data.homeRows.map((h) => (
                  <HomeRowView key={h.id} home={h} update={updateHomeAction.bind(null, h.id)} remove={removeHomeAction.bind(null, h.id)} />
                ))}
              </tbody>
            </table>
          </div>
          <AddHomeForm action={addHomeAction} costNote={data.sub ? `Each home adds ${homeCost} a month, from the next invoice. You may be asked to approve the new amount in PayPal.` : null} />
          <p className="small muted" style={{ margin: 0 }}>
            A home can only be removed if it was added by mistake: no resident has ever lived there and no shift was worked there.
          </p>
        </section>
      )}
      <section className="card">
        <h2>Home tablets</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Caregivers can only sign in on a registered tablet used at one of their homes, and their shift is recorded at that home. A tablet can be used at
          more than one home; caregivers then choose the home when they sign in to their shift. On a tablet, each person sets a PIN after signing in; the tablet locks after 2 minutes without a touch and hides everything until the PIN is entered.
        </p>
        {here ? (
          <div className="row">
            <span className="pill ok">This browser is the registered tablet “{here.name}”</span>
            <ForgetDeviceButton action={forgetThisDeviceAction} />
          </div>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>To register a tablet, open this page on the tablet itself, signed in as an owner or administrator.</p>
            <RegisterDeviceForm action={registerDeviceAction} homes={homeOptions} />
          </>
        )}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Tablet</th><th>Used at</th><th>Registered</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {active.length ? active.map(({ d, homes, by }) => (
                <tr key={d.id}>
                  <td>{d.name}{here?.id === d.id && <span className="pill info" style={{ marginLeft: 6 }}>This one</span>}</td>
                  <td><DeviceHomesForm action={deviceHomesAction} deviceId={d.id} name={d.name} homes={homeOptions} current={homes} /></td>
                  <td>{when(d.registeredAt)}{by && <span className="small muted"> · {by}</span>}</td>
                  <td>{when(d.lastSeenAt)}</td>
                  <td><RevokeDeviceButton action={revokeDeviceAction} deviceId={d.id} name={d.name} /></td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No tablets registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <LogoForm logo={logoDataUrl(data.org.logo)} orgName={data.org.name} />
      <ResidentCheckForm action={residentCheckAction} current={data.org.residentCheck} />
      <AppointmentRemindersForm action={appointmentRemindersAction} current={data.org.appointmentReminders} options={Object.entries(REMINDER_TIMES).map(([k, v]) => [k, v.label, v.detail])} />
      <section className="card" aria-labelledby="adl-h">
        <h2 id="adl-h">Daily care activities</h2>
        <p className="small muted" style={{ margin: 0 }}>
          What caregivers record for each resident every shift under Daily care. Add what your homes track, and hide what they don&apos;t. Hiding an activity keeps its past records.
        </p>
        <div className="tablewrap">
          <table className="fit-sm">
            <tbody>
              {data.activities.map((a) => (
                <tr key={a.key}>
                  <td>
                    <b className={a.hidden ? "muted" : undefined}>{a.name}</b>
                    <span className="small muted"> · {a.builtIn ? "built in" : "added"}{a.hidden ? " · hidden" : ""}</span>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <ToggleActivityButton action={toggleActivityAction.bind(null, a.key, !a.hidden)} hidden={a.hidden} name={a.name} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <AddActivityForm action={addActivityAction} />
      </section>
      <section className="card" id="billing" aria-labelledby="billing-h">
        <div className="row">
          <h2 id="billing-h" style={{ margin: 0 }}>Billing</h2>
          <span className={`pill ${bill.tone}`}>{bill.label}</span>
        </div>
        {data.sub ? (
          <>
            <div className="kpis">
              <div><span className="small muted">Plan</span><br /><b>{PRICE_SUMMARY} per home per month</b><br /><span className="small muted">{stageNote}</span></div>
              <div>
                <span className="small muted">This billing cycle</span><br />
                <b>{cycle ? showPeriod(cycle) : "—"}</b><br />
                <span className="small muted">{cycle ? `Invoice on ${showDay(cycle.invoiceOn)}` : ""}</span>
              </div>
              {unpaid ? (
                <div>
                  <span className="small muted">{unpaid.lateAt ? "Late" : "Next payment"}</span><br />
                  <b>{cents(unpaid.amountCents)}</b><br />
                  <span className="small muted">Invoice {invoiceNumber(unpaid)}, due {showDay(unpaid.dueOn, true)}</span>
                </div>
              ) : (
                cycle && (
                  <div>
                    <span className="small muted">Next payment, as of today</span><br />
                    <b>{cents(homesNow * cycle.perHomeCents)}</b><br />
                    <span className="small muted">{describeBill({ homes: homesNow })} × {cents(cycle.perHomeCents)}, {final ? "final invoice, due" : invoiceBilled(data.sub) ? "due" : "charged"} {showDay(cycle.dueOn, true)}</span>
                  </div>
                )
              )}
              <div><span className="small muted">Billed for</span><br /><b>{describeBill({ homes: data.sub.quantity })}</b></div>
            </div>
            {bill.warning && <p className={bill.tone === "crit" ? "error" : "notice"} style={{ margin: 0 }}>{bill.warning}</p>}
            {data.sub.approvalUrl && (
              <a className="btn primary" href={data.sub.approvalUrl} target="_blank" rel="noreferrer" style={{ justifySelf: "start" }}>Approve the new amount in PayPal</a>
            )}
            {data.invoices.length > 0 && (
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Invoice</th><th>Billing period</th><th>Homes</th><th>Amount</th><th>Due</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.invoices.map((i) => (
                      <tr key={i.id}>
                        <td>{invoiceNumber(i)}</td>
                        <td>{showPeriod({ start: i.periodStart, end: i.periodEnd })}</td>
                        <td>{i.homes} × {cents(i.perHomeCents)}</td>
                        <td>{cents(i.amountCents)}{i.lateFeeCents > 0 && <span className="small muted"> + {cents(i.lateFeeCents)} late fee</span>}</td>
                        <td>{showDay(i.dueOn, true)}</td>
                        <td>
                          {i.paidAt ? (
                            <span className="pill ok">Paid {showDay(dayIn(i.paidAt))}</span>
                          ) : i.lateAt ? (
                            <span className="pill crit">Late</span>
                          ) : (
                            <span className="pill mute">Due{i.paypalInvoiceId ? " · PayPal invoice" : ""}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {invoiceBilled(data.sub) ? (
              <p className="small muted" style={{ margin: 0 }}>
                Priced per home, with any number of residents. Every billing cycle runs from the {CYCLE_DAY}th of one month to the {CYCLE_DAY}th of the next. The
                invoice goes out the day after as a PayPal invoice to {data.sub.payerEmail ?? "your billing contact"}, uses the number of homes you have then, and is due on
                the {DUE_DAY}th; pay it by card or with PayPal. A payment still missing on the {LATE_DAY}th is late: a {usd(LATE_FEE)} late fee is added and admin
                features pause until it&apos;s paid. To change the billing contact or cancel, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. Care records
                are never locked for a missed payment.
              </p>
            ) : (
              <p className="small muted" style={{ margin: 0 }}>
              Priced per home, with any number of residents. Every billing cycle runs from the {CYCLE_DAY}th of one month to the {CYCLE_DAY}th of the next. The
              invoice goes out the day after, uses the number of homes you have then, and PayPal takes the payment automatically on the {DUE_DAY}th. A payment
              still missing on the {LATE_DAY}th is late: a {usd(LATE_FEE)} late fee is added and admin features pause until it&apos;s paid. Change the payment method or cancel in your PayPal account
              {data.sub.payerEmail ? ` (${data.sub.payerEmail})` : ""}: <a href={paypalAccount} target="_blank" rel="noreferrer">PayPal automatic payments</a>. If you cancel after the free trial, the billing
              cycle you&apos;re in is the last one: everything keeps working until it ends, and its invoice comes as a PayPal invoice. Care
              records are never locked for a missed payment. CareHouse One never sees or stores card details.
            </p>
            )}
          </>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>Your organization is billed by invoice. Questions: <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.</p>
        )}
      </section>
    </>
  );
}
