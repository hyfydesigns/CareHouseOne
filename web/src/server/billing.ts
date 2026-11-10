import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { billingEvents, billingInvoices, facilities, subscriptions, users, type BillingInvoice, type Subscription } from "@/db/schema";
import {
  addDays,
  cents,
  cycleEnding,
  dayIn,
  daysBetween,
  LATE_FEE,
  lastCycleEndBefore,
  paypalTerms,
  scheduleFor,
  showDay,
  showPeriod,
  type BillingSchedule,
  type Cycle,
  type Day,
} from "@/lib/billing-cycle";
import { randomToken, sha256 } from "@/lib/crypto";
import { appBaseUrl } from "@/lib/hosts";
import { INTRO_PRICE_PER_HOME, monthlyBill, PRICE_PER_HOME, usd, type MonthlyBill, type PriceStage } from "@/lib/pricing";
import { audit, sendMail } from "./audit";
import { getSubscription, paypalConfigured, reviseQuantity, sendLateFeeInvoice, TRIAL_DAYS, type PaypalSubscription } from "./paypal";
import { provisionOrganization, provisionSchema } from "./provision";

export const SETUP_DAYS = 7;
const DAY = 86_400_000;

/** Self-service sign-up stays closed until the customer BAA and terms are final (SIGNUP_OPEN=true). */
export function signupOpen(): boolean {
  return process.env.SIGNUP_OPEN === "true" && paypalConfigured();
}

function fromPaypal(p: PaypalSubscription, now: Date) {
  const failed = p.billing_info?.failed_payments_count ?? 0;
  const owed = Number(p.billing_info?.outstanding_balance?.value ?? 0) || 0;
  const paidAt = p.billing_info?.last_payment?.time;
  return {
    status: p.status,
    quantity: Math.max(1, Number(p.quantity ?? 1) || 1),
    payerEmail: p.subscriber?.email_address?.toLowerCase() ?? null,
    payerName: [p.subscriber?.name?.given_name, p.subscriber?.name?.surname].filter(Boolean).join(" ") || null,
    nextBillingAt: p.billing_info?.next_billing_time ? new Date(p.billing_info.next_billing_time) : null,
    lastPaymentAt: paidAt ? new Date(paidAt) : null,
    failedPayments: failed,
    syncedAt: now,
    behind: p.status === "SUSPENDED" || failed > 0,
    owed,
  };
}

/** The terms the sign-up page asks PayPal for, worked out on the server at the moment of sign-up. */
export function subscriptionTerms(now = new Date()) {
  return paypalTerms(scheduleFor(now));
}

/**
 * The schedule a new subscription runs on, if PayPal's copy (start date and first-cycle price)
 * matches what we offered when it was created; anything else was tampered with or is stale.
 * The page worked the terms out moments before PayPal created it, possibly just before midnight.
 */
export function confirmTerms(p: PaypalSubscription, now = new Date()): BillingSchedule | null {
  const created = p.create_time ? new Date(p.create_time) : now;
  const cycles = p.plan?.billing_cycles ?? [];
  const first = cycles.find((c) => c.sequence === 1)?.pricing_scheme?.fixed_price?.value;
  const intro = cycles.find((c) => c.sequence === 2)?.total_cycles;
  if (!p.start_time || first === undefined) return null;
  for (const at of [created, new Date(created.getTime() - 6 * 3_600_000)]) {
    const s = scheduleFor(at);
    const t = paypalTerms(s);
    if (new Date(p.start_time).getTime() === new Date(t.start_time).getTime() && Math.round(Number(first) * 100) === s.firstPerHomeCents && (intro === undefined || intro === s.introCycles)) return s;
  }
  return null;
}

/** A subscription's schedule as stored (null for one from before the billing calendar). */
export function scheduleOf(row: Pick<Subscription, "trialEndsOn" | "firstCycleEnd" | "firstPerHomeCents" | "introCycles" | "startsOn">): BillingSchedule | null {
  if (!row.trialEndsOn || !row.firstCycleEnd || row.firstPerHomeCents === null || row.introCycles === null || !row.startsOn) return null;
  return { trialEndsOn: row.trialEndsOn, firstCycleEnd: row.firstCycleEnd, firstPerHomeCents: row.firstPerHomeCents, introCycles: row.introCycles, startsOn: row.startsOn };
}

/**
 * Step 1 of sign-up, after the buyer approves the subscription in the PayPal window: confirm it
 * with PayPal (never trust the browser), record it, and email a single-use setup link.
 */
export async function registerSubscription(db: DB, subscriptionId: string, appUrl: string, now = new Date()): Promise<{ ok: true; setupUrl: string } | { ok: false; error: string }> {
  if (!signupOpen()) return { ok: false, error: "Sign-up isn't open yet." };
  let p: PaypalSubscription;
  try {
    p = await getSubscription(subscriptionId, true);
  } catch {
    return { ok: false, error: "We couldn't confirm the subscription with PayPal. Try again in a minute." };
  }
  if (p.plan_id !== process.env.PAYPAL_PLAN_ID) return { ok: false, error: "That isn't a CareHouse One subscription." };
  if (!["APPROVED", "ACTIVE"].includes(p.status)) return { ok: false, error: "PayPal hasn't approved this subscription." };
  const v = fromPaypal(p, now);
  if (v.quantity > 100) return { ok: false, error: "That subscription's number of homes doesn't look right. Email us and we'll sort it out." };
  const schedule = confirmTerms(p, now);
  if (!schedule) return { ok: false, error: "That subscription's start date or first payment doesn't match our billing calendar. Email us and we'll sort it out." };
  const token = randomToken();
  const setup = { setupTokenHash: sha256(token), setupExpiresAt: new Date(now.getTime() + SETUP_DAYS * DAY) };
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, p.id));
  if (existing?.orgId) return { ok: false, error: "This subscription is already set up. Sign in at the app instead." };
  const values = {
    planId: p.plan_id,
    status: v.status,
    quantity: v.quantity,
    payerEmail: v.payerEmail,
    payerName: v.payerName,
    nextBillingAt: v.nextBillingAt,
    failedPayments: v.failedPayments,
    syncedAt: now,
    ...schedule,
    ...setup,
  };
  if (existing) await db.update(subscriptions).set(values).where(eq(subscriptions.id, existing.id));
  else await db.insert(subscriptions).values({ paypalSubscriptionId: p.id, ...values });
  const setupUrl = `${appUrl}/setup/${token}`;
  if (v.payerEmail) {
    await sendMail(db, {
      orgId: null,
      to: v.payerEmail,
      subject: "Finish setting up CareHouse One",
      body: `Thanks for subscribing to CareHouse One. Your ${TRIAL_DAYS}-day free trial has started.\n\nIf you closed the page before finishing, use this link to set up your organization. It works once and expires in ${SETUP_DAYS} days.\n\n${setupUrl}`,
    });
  }
  return { ok: true, setupUrl };
}

/**
 * "Send me a new setup link": for someone who paid but didn't finish setting up within 7 days.
 * Only goes to the PayPal email on the subscription; says nothing about whether one exists.
 */
export async function resendSetupLink(db: DB, email: string, appUrl: string, now = new Date()): Promise<void> {
  if (!signupOpen()) return;
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.payerEmail, email.trim().toLowerCase()), isNull(subscriptions.orgId), isNull(subscriptions.setupUsedAt), inArray(subscriptions.status, ["APPROVED", "ACTIVE"])));
  for (const row of rows) {
    const token = randomToken();
    await db.update(subscriptions).set({ setupTokenHash: sha256(token), setupExpiresAt: new Date(now.getTime() + SETUP_DAYS * DAY) }).where(eq(subscriptions.id, row.id));
    await sendMail(db, {
      orgId: null,
      to: row.payerEmail!,
      subject: "Your new CareHouse One setup link",
      body: `Here's a new link to set up your organization in CareHouse One. It works once and expires in ${SETUP_DAYS} days.\n\n${appUrl}/setup/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
    });
  }
}

/** For the setup page: is this link still usable, and who paid? */
export async function describeSetup(db: DB, token: string, now = new Date()) {
  const [s] = await db.select().from(subscriptions).where(eq(subscriptions.setupTokenHash, sha256(token)));
  if (!s || s.orgId || s.setupUsedAt || !s.setupExpiresAt || s.setupExpiresAt < now) return null;
  return { payerEmail: s.payerEmail, payerName: s.payerName, quantity: s.quantity };
}

const setupSchema = provisionSchema.extend({
  accepted: z.literal(true, { message: "Accept the Terms of Service and the Business Associate Agreement to continue." }),
});

/** Step 2: the organization, its homes and the owner. The owner then gets the usual invitation email. */
export async function completeSetup(db: DB, token: string, raw: unknown, appUrl: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  if (!signupOpen()) return { ok: false, error: "Sign-up isn't open yet." };
  const p = setupSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  try {
    const { orgId } = await provisionOrganization(db, p.data, appUrl, { setupTokenHash: sha256(token) });
    await audit(db, { orgId, actorId: null, action: "terms_accepted", entity: "organization", entityId: orgId, details: { by: p.data.owner.email, documents: ["terms", "baa"] } });
    return { ok: true, email: p.data.owner.email };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** "Monday, January 5" */
const longDay = (d: Day) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });

/** "INV-202612-3F9A2C": the month the cycle ends, and the start of the invoice's ID. */
export const invoiceNumber = (i: Pick<BillingInvoice, "id" | "periodEnd">) => `INV-${i.periodEnd.slice(0, 7).replace("-", "")}-${i.id.slice(0, 6).toUpperCase()}`;

/**
 * Updates our copy from PayPal, marks invoices paid once PayPal has the money, and emails the
 * billing contacts the first time a payment fails.
 */
async function applyPaypal(db: DB, row: Subscription, p: PaypalSubscription, now: Date): Promise<void> {
  const v = fromPaypal(p, now);
  const pastDueSince = v.behind ? (row.pastDueSince ?? now) : null;
  await db
    .update(subscriptions)
    .set({ status: v.status, quantity: v.quantity, nextBillingAt: v.nextBillingAt, lastPaymentAt: v.lastPaymentAt ?? row.lastPaymentAt, failedPayments: v.failedPayments, pastDueSince, syncedAt: now })
    .where(eq(subscriptions.id, row.id));
  if (!v.behind && v.owed === 0 && v.lastPaymentAt) await settleInvoices(db, row, v.lastPaymentAt);
  if (row.orgId && v.behind && !row.pastDueSince) {
    const [open] = await db.select().from(billingInvoices).where(and(eq(billingInvoices.subscriptionId, row.id), isNull(billingInvoices.paidAt))).orderBy(asc(billingInvoices.dueOn)).limit(1);
    const by = open ? longDay(open.lateOn) : "the 10th";
    for (const to of await billingContacts(db, row)) {
      await sendMail(db, {
        orgId: row.orgId,
        to,
        subject: "Your CareHouse One payment didn't go through",
        body:
          `PayPal couldn't take the latest CareHouse One payment${open ? ` (${cents(open.amountCents)}, invoice ${invoiceNumber(open)})` : ""}. PayPal will try again; you can update the payment method in your PayPal account under Payments > Automatic payments.\n\n` +
          `If it's still unpaid on ${by}, the payment is late: a ${usd(LATE_FEE)} late fee is added, and adding staff, tablets and settings changes pause until it's paid. Care records and the medication record are never affected.`,
      });
    }
  }
}

/**
 * PayPal has been paid up (no failures, nothing outstanding) as of its last payment: every invoice
 * due by then is paid. When no late invoice is left, admin features come back.
 */
async function settleInvoices(db: DB, row: Subscription, paidAt: Date): Promise<void> {
  const paidThrough = addDays(dayIn(paidAt), 1);
  const settled = await db
    .update(billingInvoices)
    .set({ paidAt })
    .where(and(eq(billingInvoices.subscriptionId, row.id), isNull(billingInvoices.paidAt), lte(billingInvoices.dueOn, paidThrough)))
    .returning();
  if (!settled.length) return;
  const [stillLate] = await db.select({ id: billingInvoices.id }).from(billingInvoices).where(and(eq(billingInvoices.subscriptionId, row.id), isNull(billingInvoices.paidAt), isNotNull(billingInvoices.lateAt))).limit(1);
  if (!stillLate) await db.update(subscriptions).set({ lateSince: null }).where(eq(subscriptions.id, row.id));
  for (const i of settled) {
    await audit(db, { orgId: i.orgId, actorId: null, action: "billing_invoice_paid", entity: "billing_invoice", entityId: i.id, details: { number: invoiceNumber(i), amountCents: i.amountCents } });
  }
}

async function billingContacts(db: DB, row: Subscription): Promise<string[]> {
  if (!row.orgId) return [];
  // Owners who haven't accepted their invitation yet still hear about billing; deactivated ones don't.
  const owners = await db.select({ email: users.email }).from(users).where(and(eq(users.orgId, row.orgId), eq(users.role, "owner"), inArray(users.status, ["active", "invited"])));
  return [...new Set([row.payerEmail, ...owners.map((o) => o.email)].filter((e): e is string => !!e))];
}

type PaypalEvent = { id?: string; event_type?: string; resource?: { id?: string; billing_agreement_id?: string } };

/** A verified PayPal webhook: log it once, then refresh the subscription from PayPal (the source of truth). */
export async function handleWebhook(db: DB, event: PaypalEvent, now = new Date()): Promise<"duplicate" | "ignored" | "applied"> {
  if (!event.id || !event.event_type) return "ignored";
  const resourceId = event.event_type.startsWith("PAYMENT.SALE") ? event.resource?.billing_agreement_id : event.resource?.id;
  const inserted = await db.insert(billingEvents).values({ paypalEventId: event.id, eventType: event.event_type, resourceId: resourceId ?? null }).onConflictDoNothing().returning();
  if (!inserted.length) return "duplicate";
  if (!resourceId) return "ignored";
  const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, resourceId));
  if (!row) return "ignored";
  await applyPaypal(db, row, await getSubscription(resourceId), now);
  if (row.orgId) await audit(db, { orgId: row.orgId, actorId: null, action: "billing_event", entity: "subscription", entityId: row.id, details: { type: event.event_type } });
  return "applied";
}

/** What an organization is billed for: its homes, at the price for that point in the schedule. */
export async function orgBill(db: DB | Tx, orgId: string, stage: PriceStage = "regular"): Promise<MonthlyBill> {
  const [{ n }] = await db.select({ n: count() }).from(facilities).where(eq(facilities.orgId, orgId));
  return monthlyBill(n, stage);
}

/**
 * Housekeeping (from /api/cron, every few minutes): refresh subscriptions every 6 hours in case a
 * webhook was missed, run the billing calendar (invoices, due-day reminders, late payments), and
 * remind people whose free trial ends within 3 days.
 */
export async function syncSubscriptions(db: DB, now = new Date()): Promise<{ refreshed: number; invoiced: number; late: number; reminded: number }> {
  if (!paypalConfigured()) return { refreshed: 0, invoiced: 0, late: 0, reminded: 0 };
  const stale = new Date(now.getTime() - 6 * 3_600_000);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(isNotNull(subscriptions.orgId), inArray(subscriptions.status, ["APPROVED", "ACTIVE", "SUSPENDED"]), or(isNull(subscriptions.syncedAt), lt(subscriptions.syncedAt, stale))));
  let refreshed = 0;
  for (const row of rows) {
    try {
      await applyPaypal(db, row, await getSubscription(row.paypalSubscriptionId), now);
      refreshed++;
    } catch (e) {
      console.error(`[billing] refresh failed for ${row.id}: ${(e as Error).message}`);
    }
  }
  const { invoiced, late } = await runBillingCalendar(db, now);
  const reminded = await remindTrialEnding(db, now);
  return { refreshed, invoiced, late, reminded };
}

/**
 * The billing calendar, safe to run any number of times a day:
 *   - the day after a cycle ends, send PayPal the number of homes and issue the invoice;
 *   - on the 5th, remind the billing contacts that PayPal takes the payment today;
 *   - on the 10th, an invoice that's still unpaid is late: a late fee, a notice, admin features pause.
 */
export async function runBillingCalendar(db: DB, now = new Date()): Promise<{ invoiced: number; late: number }> {
  const today = dayIn(now);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(isNotNull(subscriptions.orgId), isNotNull(subscriptions.firstCycleEnd), inArray(subscriptions.status, ["APPROVED", "ACTIVE", "SUSPENDED"])));
  let invoiced = 0;
  let late = 0;
  for (const row of rows) {
    const schedule = scheduleOf(row);
    if (!schedule) continue;
    try {
      const cycle = cycleEnding(schedule, lastCycleEndBefore(today));
      // Never issue an invoice after its due date (say, after an outage): those are sorted out by hand.
      if (cycle && today <= cycle.dueOn) {
        const [existing] = await db.select({ id: billingInvoices.id }).from(billingInvoices).where(and(eq(billingInvoices.subscriptionId, row.id), eq(billingInvoices.periodEnd, cycle.end)));
        if (!existing && (await issueInvoice(db, row, cycle))) invoiced++;
      }
      await remindDueToday(db, row, today, now);
      late += await markLate(db, row, today, now);
    } catch (e) {
      console.error(`[billing] calendar failed for ${row.id}: ${(e as Error).message}`);
    }
  }
  return { invoiced, late };
}

async function issueInvoice(db: DB, row: Subscription, cycle: Cycle): Promise<boolean> {
  const { homes: count } = await orgBill(db, row.orgId!);
  // PayPal charges the quantity it has. When a higher amount needs the payer's approval first,
  // the invoice shows what PayPal will actually take, and the approval link is on the billing screen.
  let homes = count;
  let approvalUrl = row.approvalUrl;
  if (count !== row.quantity) {
    try {
      approvalUrl = (await reviseQuantity(row.paypalSubscriptionId, count)).approvalUrl;
      if (approvalUrl) homes = row.quantity;
    } catch (e) {
      console.error(`[billing] couldn't send PayPal the number of homes for ${row.id}: ${(e as Error).message}`);
      homes = row.quantity;
    }
    await db.update(subscriptions).set({ quantity: homes, approvalUrl }).where(eq(subscriptions.id, row.id));
  }
  const [inv] = await db
    .insert(billingInvoices)
    .values({
      orgId: row.orgId!,
      subscriptionId: row.id,
      periodStart: cycle.start,
      periodEnd: cycle.end,
      stage: cycle.stage,
      homes,
      perHomeCents: cycle.perHomeCents,
      amountCents: homes * cycle.perHomeCents,
      issuedOn: cycle.invoiceOn,
      dueOn: cycle.dueOn,
      lateOn: cycle.lateOn,
    })
    .onConflictDoNothing()
    .returning();
  if (!inv) return false;
  const priceNote = cycle.stage === "first" ? "introductory price, part of a month" : cycle.stage === "intro" ? "introductory price" : "per home";
  for (const to of await billingContacts(db, row)) {
    await sendMail(db, {
      orgId: row.orgId,
      to,
      subject: `Your CareHouse One invoice: ${cents(inv.amountCents)} due ${showDay(inv.dueOn)}`,
      body:
        `Invoice ${invoiceNumber(inv)}\n` +
        `Billing period: ${showPeriod(cycle)}\n` +
        `Homes: ${homes} × ${cents(cycle.perHomeCents)} (${priceNote})\n` +
        `Amount due: ${cents(inv.amountCents)}\n` +
        `Due: ${longDay(inv.dueOn)}\n\n` +
        `PayPal takes this payment automatically on ${longDay(inv.dueOn)}; you don't need to do anything.\n\n` +
        (approvalUrl && count !== homes ? `You now have ${count} homes. Approve the new amount in PayPal (Settings > Billing in CareHouse One) so the next invoice includes them.\n\n` : "") +
        `If the payment hasn't gone through by ${longDay(inv.lateOn)}, it's late: a ${usd(LATE_FEE)} late fee is added, and adding staff, tablets and settings changes pause until it's paid. Care records are never affected.\n\n` +
        `Your invoices are in CareHouse One under Settings > Billing.`,
    });
  }
  await audit(db, { orgId: row.orgId!, actorId: null, action: "billing_invoice_issued", entity: "billing_invoice", entityId: inv.id, details: { number: invoiceNumber(inv), homes, amountCents: inv.amountCents, dueOn: inv.dueOn, needsApproval: !!approvalUrl && count !== homes } });
  return true;
}

/** On the 5th: PayPal takes the payment today. Sent once per invoice, and not if it's already paid. */
async function remindDueToday(db: DB, row: Subscription, today: Day, now: Date): Promise<void> {
  const due = await db
    .update(billingInvoices)
    .set({ remindedAt: now })
    .where(and(eq(billingInvoices.subscriptionId, row.id), eq(billingInvoices.dueOn, today), isNull(billingInvoices.paidAt), isNull(billingInvoices.remindedAt)))
    .returning();
  for (const inv of due) {
    for (const to of await billingContacts(db, row)) {
      await sendMail(db, {
        orgId: row.orgId,
        to,
        subject: `Your CareHouse One payment of ${cents(inv.amountCents)} is due today`,
        body:
          `PayPal takes the payment for invoice ${invoiceNumber(inv)} (${showPeriod({ start: inv.periodStart, end: inv.periodEnd })}) today: ${cents(inv.amountCents)}. You don't need to do anything if your PayPal payment method is up to date.\n\n` +
          `If it hasn't gone through by ${longDay(inv.lateOn)}, a ${usd(LATE_FEE)} late fee is added and admin features pause until it's paid.`,
      });
    }
  }
}

/** On the 10th: check with PayPal once more, then anything still unpaid is late. */
async function markLate(db: DB, row: Subscription, today: Day, now: Date): Promise<number> {
  const unpaid = () => db.select().from(billingInvoices).where(and(eq(billingInvoices.subscriptionId, row.id), isNull(billingInvoices.paidAt), isNull(billingInvoices.lateAt), lte(billingInvoices.lateOn, today)));
  if (!(await unpaid()).length) return 0;
  await applyPaypal(db, row, await getSubscription(row.paypalSubscriptionId), now);
  const overdue = await unpaid();
  for (const inv of overdue) {
    const feeCents = LATE_FEE * 100;
    let feeInvoiceId: string | null = null;
    if (row.payerEmail && feeCents > 0) {
      try {
        feeInvoiceId = await sendLateFeeInvoice(row.payerEmail, feeCents, `Late fee for CareHouse One invoice ${invoiceNumber(inv)}, due ${showDay(inv.dueOn, true)}.`);
      } catch (e) {
        console.error(`[billing] late fee invoice failed for ${inv.id}: ${(e as Error).message}`);
      }
    }
    await db.update(billingInvoices).set({ lateAt: now, lateFeeCents: feeCents, lateFeeInvoiceId: feeInvoiceId }).where(eq(billingInvoices.id, inv.id));
    await db.update(subscriptions).set({ lateSince: row.lateSince ?? now }).where(eq(subscriptions.id, row.id));
    for (const to of await billingContacts(db, row)) {
      await sendMail(db, {
        orgId: row.orgId,
        to,
        subject: "Your CareHouse One payment is late",
        body:
          `The payment for invoice ${invoiceNumber(inv)} (${cents(inv.amountCents)}, due ${longDay(inv.dueOn)}) hasn't gone through, so it's now late.\n\n` +
          `A ${usd(LATE_FEE)} late fee has been added. ${feeInvoiceId ? "PayPal is emailing you a separate invoice for it." : "We'll send you an invoice for it."}\n\n` +
          `Until the payment goes through, adding staff, tablets and settings changes are paused. Care records and the medication record keep working.\n\n` +
          `To fix it, update the payment method in your PayPal account under Payments > Automatic payments; PayPal will try the payment again.`,
      });
    }
    await audit(db, { orgId: row.orgId!, actorId: null, action: "billing_invoice_late", entity: "billing_invoice", entityId: inv.id, details: { number: invoiceNumber(inv), lateFeeCents: feeCents, lateFeeInvoiceId: feeInvoiceId } });
  }
  return overdue.length;
}

export const TRIAL_REMINDER_DAYS = 3;

/**
 * Three days before the trial ends, tell the billing contacts how billing works from then on and
 * what the first invoice will be. Sent once. Someone who paid but never set up their organization
 * gets a fresh setup link (only a hash of the first one was kept).
 */
async function remindTrialEnding(db: DB, now: Date): Promise<number> {
  const today = dayIn(now);
  const rows = await db
    .select()
    .from(subscriptions)
    .where(and(isNull(subscriptions.trialReminderSentAt), isNotNull(subscriptions.trialEndsOn), inArray(subscriptions.status, ["APPROVED", "ACTIVE"])));
  let sent = 0;
  for (const row of rows) {
    const schedule = scheduleOf(row);
    if (!schedule) continue;
    const left = daysBetween(today, schedule.trialEndsOn);
    if (left < 1 || left > TRIAL_REMINDER_DAYS) continue;
    const first = cycleEnding(schedule, schedule.firstCycleEnd)!;
    let setupNote = "";
    if (!row.orgId) {
      const token = randomToken();
      await db.update(subscriptions).set({ setupTokenHash: sha256(token), setupExpiresAt: new Date(now.getTime() + SETUP_DAYS * DAY) }).where(eq(subscriptions.id, row.id));
      setupNote = `\n\nYou haven't set up your organization yet. Use this link to do it now (it works once and expires in ${SETUP_DAYS} days):\n${appBaseUrl()}/setup/${token}`;
    }
    const homes = row.quantity;
    const contacts = row.orgId ? await billingContacts(db, row) : [row.payerEmail].filter((e): e is string => !!e);
    for (const to of contacts) {
      await sendMail(db, {
        orgId: row.orgId,
        to,
        subject: `Your CareHouse One free trial ends on ${longDay(schedule.trialEndsOn)}`,
        body:
          `Your ${TRIAL_DAYS}-day free trial of CareHouse One ends on ${longDay(schedule.trialEndsOn)}. From then on you're on our standard billing cycle, which runs from the 28th of one month to the 28th of the next. ` +
          `Each invoice goes out the day after a cycle ends, and PayPal takes the payment automatically on the 5th.\n\n` +
          `Your first invoice, on ${longDay(first.invoiceOn)}, covers ${showPeriod(first)}: ${homes} home${homes === 1 ? "" : "s"} × ${cents(first.perHomeCents)} = ${cents(homes * first.perHomeCents)} (the introductory price for part of a month). PayPal takes it on ${longDay(first.dueOn)}.\n\n` +
          `After that it's ${usd(INTRO_PRICE_PER_HOME)} per home a month for ${schedule.introCycles} more month${schedule.introCycles === 1 ? "" : "s"}, then ${usd(PRICE_PER_HOME)} per home a month.\n\n` +
          `To keep using CareHouse One you don't need to do anything. If you add or remove a home, the next invoice uses the new number of homes.\n\n` +
          `To cancel before you're charged, sign in to PayPal and go to Settings > Payments > Automatic payments, then cancel CareHouse One.` +
          setupNote,
      });
    }
    await db.update(subscriptions).set({ trialReminderSentAt: now }).where(eq(subscriptions.id, row.id));
    if (row.orgId) await audit(db, { orgId: row.orgId, actorId: null, action: "trial_reminder_sent", entity: "subscription", entityId: row.id, details: { trialEndsOn: schedule.trialEndsOn, firstDueOn: first.dueOn } });
    sent++;
  }
  return sent;
}

export interface BillingState {
  managed: boolean;
  label: string;
  tone: "ok" | "warn" | "crit" | "mute";
  /** Admin features (inviting staff, tablets, settings) pause; care records never do. */
  adminLocked: boolean;
  warning: string | null;
}

export function billingState(s: Subscription | null | undefined, now = new Date()): BillingState {
  if (!s) return { managed: true, label: "Billed by invoice", tone: "mute", adminLocked: false, warning: null };
  if (s.status === "CANCELLED" || s.status === "EXPIRED") {
    return { managed: false, label: "Cancelled", tone: "crit", adminLocked: true, warning: "The subscription is cancelled. Care records stay available; adding staff, tablets and settings changes are paused." };
  }
  if (s.lateSince) {
    return {
      managed: false,
      label: "Payment late",
      tone: "crit",
      adminLocked: true,
      warning: `A payment is late and a ${usd(LATE_FEE)} late fee was added. Adding staff, tablets and settings changes are paused until PayPal takes the payment. Care records keep working.`,
    };
  }
  if (s.pastDueSince) {
    return {
      managed: false,
      label: "Payment failed",
      tone: "crit",
      adminLocked: false,
      warning: "PayPal couldn't take the latest payment. Update the payment method in PayPal before the 10th to avoid a late fee and a pause on admin features. Care records are never affected.",
    };
  }
  if (s.approvalUrl) return { managed: false, label: "Approval needed", tone: "warn", adminLocked: false, warning: "Approve the new number of homes in PayPal." };
  const trial = s.trialEndsOn ? dayIn(now) < s.trialEndsOn : now.getTime() - s.createdAt.getTime() < TRIAL_DAYS * DAY;
  return { managed: false, label: trial ? "Free trial" : "Active", tone: "ok", adminLocked: false, warning: null };
}

/** For admin actions inside a tenant: an error message when billing has paused admin features. */
export async function adminLockedMessage(tx: Tx): Promise<string | null> {
  const [s] = await tx.select().from(subscriptions);
  const st = billingState(s);
  return st.adminLocked ? "This is paused until the subscription is paid. Care records aren't affected. See Settings > Billing." : null;
}

export async function orgSubscription(tx: Tx): Promise<Subscription | null> {
  const [s] = await tx.select().from(subscriptions);
  return s ?? null;
}

/** The organization's invoices, newest first (inside a tenant). */
export function orgInvoices(tx: Tx, limit = 24): Promise<BillingInvoice[]> {
  return tx.select().from(billingInvoices).orderBy(desc(billingInvoices.periodEnd)).limit(limit);
}
