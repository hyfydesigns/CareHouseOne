import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, billingEvents, billingInvoices, leads, organizations, outbox, subscriptions } from "@/db/schema";
import { describeToken } from "@/server/auth";
import { cents, cycleEnding, cycleOn, dayIn, dueDay, finalCycleEnd, invoiceDay, paypalTerms, scheduleFor } from "@/lib/billing-cycle";
import { monthlyBill } from "@/lib/pricing";
import {
  adminLockedMessage,
  billingState,
  completeSetup,
  confirmTerms,
  describeSetup,
  handleWebhook,
  orgBill,
  orgInvoices,
  registerSubscription,
  resendSetupLink,
  startSubscription,
  runBillingCalendar,
  subscriptionTerms,
  syncSubscriptions,
} from "@/server/billing";
import { createLead } from "@/server/leads";
import { resetPaypalToken } from "@/server/paypal";
import { seedCare, seedDemo, type Seeded } from "@/server/seed";

const APP = "https://app.example.test";
const PLAN = "P-TESTPLAN123";
let db: DB;
let s: Seeded;

// A tiny stand-in for PayPal's API: subscriptions by ID, what revise returns, and invoices sent.
const paypal = new Map<string, Record<string, unknown>>();
const revised: Array<{ id: string; quantity: string }> = [];
const feeInvoices: Array<{ email: string; value: string }> = [];
const sentInvoices: Array<{ id: string; email: string; item: string; quantity: string; value: string; number?: string; dueOn?: string }> = [];
const invoiceStatus = new Map<string, string>();
const created: Array<Record<string, unknown>> = [];
let reviseNeedsApproval = true;

function stubPaypal() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/v1/oauth2/token")) return json({ access_token: "test-token", expires_in: 3600 });
    const rev = u.match(/\/v1\/billing\/subscriptions\/([^/]+)\/revise$/);
    if (rev) {
      revised.push({ id: rev[1], quantity: JSON.parse(String(init?.body)).quantity });
      return json({ links: reviseNeedsApproval ? [{ rel: "approve", href: "https://www.sandbox.paypal.com/approve/x" }] : [] });
    }
    if (u.endsWith("/v2/invoicing/invoices")) {
      const b = JSON.parse(String(init?.body));
      const id = `INV2-TEST-${String(sentInvoices.length + 1).padStart(4, "0")}`;
      const email = b.primary_recipients[0].billing_info.email_address;
      const item = b.items[0];
      if (item.name.includes("late fee")) feeInvoices.push({ email, value: item.unit_amount.value });
      sentInvoices.push({ id, email, item: item.name, quantity: item.quantity, value: item.unit_amount.value, number: b.detail.invoice_number, dueOn: b.detail.payment_term.due_date });
      invoiceStatus.set(id, "DRAFT");
      return json({ href: `https://api-m.sandbox.paypal.com/v2/invoicing/invoices/${id}` }, 201);
    }
    const send = u.match(/\/v2\/invoicing\/invoices\/(INV2-[A-Z0-9-]+)\/send$/);
    if (send && invoiceStatus.has(send[1])) {
      invoiceStatus.set(send[1], "SENT");
      return json({}, 202);
    }
    const inv = u.match(/\/v2\/invoicing\/invoices\/(INV2-[A-Z0-9-]+)$/);
    if (inv) return invoiceStatus.has(inv[1]) ? json({ id: inv[1], status: invoiceStatus.get(inv[1]) }) : json({}, 404);
    if (u.endsWith("/v1/billing/subscriptions") && init?.method === "POST") {
      created.push(JSON.parse(String(init.body)));
      return json({ id: `I-NEW${String(created.length).padStart(7, "0")}`, status: "APPROVAL_PENDING" }, 201);
    }
    const get = u.match(/\/v1\/billing\/subscriptions\/([^/?]+)(\?fields=plan)?$/);
    if (get) return paypal.has(get[1]) ? json(paypal.get(get[1])) : json({ name: "RESOURCE_NOT_FOUND" }, 404);
    return json({}, 404);
  });
}

// A subscription as PayPal returns it, created now with the terms the sign-up page asked for.
const sub = (id: string, extra: Record<string, unknown> = {}) => {
  const terms = subscriptionTerms();
  paypal.set(id, {
    id,
    plan_id: PLAN,
    status: "ACTIVE",
    quantity: "1",
    create_time: new Date().toISOString(),
    start_time: terms.start_time,
    plan: { billing_cycles: [...terms.plan.billing_cycles.map((c) => ({ ...c })), { sequence: 3, total_cycles: 0 }] },
    subscriber: { email_address: "Payer@Example.test", name: { given_name: "Jordan", surname: "Lee" } },
    billing_info: { next_billing_time: terms.start_time, failed_payments_count: 0 },
    ...extra,
  });
};

const tokenFrom = (url: string) => url.split("/setup/")[1];
const setupInput = (email: string) => ({
  orgName: "Riverside Homes",
  homes: [{ name: "Oak House", timeZone: "America/Chicago", beds: 6 }],
  owner: { name: "Jordan Lee", email },
  accepted: true,
});

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  await seedCare(db, s);
  stubPaypal();
});

afterAll(() => {
  vi.unstubAllGlobals();
});

beforeEach(() => {
  resetPaypalToken();
  vi.stubEnv("SIGNUP_OPEN", "true");
  vi.stubEnv("PAYPAL_CLIENT_ID", "client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
  vi.stubEnv("PAYPAL_PLAN_ID", PLAN);
});

describe("sign-up", () => {
  it("creates the subscription on PayPal with today's start date and prorated first cycle", async () => {
    const now = new Date("2026-11-11T15:00:00Z");
    expect(await startSubscription(3, now)).toEqual({ ok: true, id: "I-NEW0000001" });
    expect(created.at(-1)).toMatchObject({ plan_id: PLAN, quantity: "3", ...subscriptionTerms(now), application_context: { shipping_preference: "NO_SHIPPING" } });
    expect(await startSubscription(0, now)).toMatchObject({ ok: false });
    expect(await startSubscription(2.5, now)).toMatchObject({ ok: false });
    expect(await startSubscription("x", now)).toMatchObject({ ok: false });
    vi.stubEnv("SIGNUP_OPEN", "false");
    expect(await startSubscription(1, now)).toMatchObject({ ok: false, error: expect.stringMatching(/isn't open/) });
    expect(created).toHaveLength(1);
  });

  it("stays closed until SIGNUP_OPEN is on", async () => {
    vi.stubEnv("SIGNUP_OPEN", "false");
    sub("I-CLOSED0001");
    const r = await registerSubscription(db, "I-CLOSED0001", APP);
    expect(!r.ok && r.error).toMatch(/isn't open/);
  });

  it("confirms the subscription with PayPal, emails a setup link, and sets up the organization once", async () => {
    sub("I-GOOD000001");
    const r = await registerSubscription(db, "I-GOOD000001", APP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const token = tokenFrom(r.setupUrl);
    expect(await describeSetup(db, token)).toMatchObject({ payerEmail: "payer@example.test", payerName: "Jordan Lee", quantity: 1 });
    const [mail] = await db.select().from(outbox).where(eq(outbox.to, "payer@example.test"));
    expect(mail.body).toContain(r.setupUrl);

    const notAccepted = await completeSetup(db, token, { ...setupInput("jordan@riverside.test"), accepted: false }, APP);
    expect(!notAccepted.ok && notAccepted.error).toMatch(/Accept the Terms/);

    const done = await completeSetup(db, token, setupInput("jordan@riverside.test"), APP);
    expect(done.ok).toBe(true);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-GOOD000001"));
    expect(row.orgId).not.toBeNull();
    // The billing calendar it signed up on is kept with it.
    expect(row).toMatchObject(scheduleFor(new Date()));
    const [org] = await db.select().from(organizations).where(eq(organizations.id, row.orgId!));
    expect(org.name).toBe("Riverside Homes");
    const accepted = await db.select().from(auditLog).where(eq(auditLog.action, "terms_accepted"));
    expect(accepted).toHaveLength(1);

    // The owner's invitation works like any other.
    const [invite] = await db.select().from(outbox).where(eq(outbox.to, "jordan@riverside.test"));
    expect(await describeToken(db, invite.body.match(/\/invite\/([\w-]+)/)![1], ["invite"])).toMatchObject({ email: "jordan@riverside.test" });

    // The link works once, and the subscription can't be registered again.
    expect((await completeSetup(db, token, setupInput("other@riverside.test"), APP)).ok).toBe(false);
    const again = await registerSubscription(db, "I-GOOD000001", APP);
    expect(!again.ok && again.error).toMatch(/already set up/);
  });

  it("refuses other plans, unapproved subscriptions, an impossible number of homes and made-up IDs", async () => {
    sub("I-OTHERPLAN1", { plan_id: "P-SOMETHINGELSE" });
    sub("I-PENDING001", { status: "APPROVAL_PENDING" });
    sub("I-HUGE000001", { quantity: "149" });
    const huge = await registerSubscription(db, "I-HUGE000001", APP);
    expect(!huge.ok && huge.error).toMatch(/doesn't look right/);
    expect((await registerSubscription(db, "I-OTHERPLAN1", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "I-PENDING001", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "I-NOTREAL0001", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "../../v1/oauth2", APP)).ok).toBe(false);
  });

  it("refuses a subscription whose start date or first payment was changed in the browser", async () => {
    const terms = subscriptionTerms();
    sub("I-CHEAP000001", { plan: { billing_cycles: [{ sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: "0.01" } } }, { sequence: 2, total_cycles: 3 }] } });
    sub("I-LATER000001", { start_time: new Date(new Date(terms.start_time).getTime() + 31 * 86_400_000).toISOString() });
    sub("I-NOPLAN00001", { plan: undefined });
    for (const id of ["I-CHEAP000001", "I-LATER000001", "I-NOPLAN00001"]) {
      const r = await registerSubscription(db, id, APP);
      expect(!r.ok && r.error).toMatch(/billing calendar/);
    }
  });
});

describe("billing status", () => {
  it("logs each webhook once and emails the billing contact when a payment fails", async () => {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-GOOD000001"));
    sub("I-GOOD000001", { status: "SUSPENDED", billing_info: { failed_payments_count: 1 } });
    const event = { id: "WH-1", event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED", resource: { id: "I-GOOD000001" } };
    expect(await handleWebhook(db, event)).toBe("applied");
    expect(await handleWebhook(db, event)).toBe("duplicate");
    expect(await db.select().from(billingEvents)).toHaveLength(1);
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(after.status).toBe("SUSPENDED");
    expect(after.pastDueSince).not.toBeNull();
    const failedMail = await db.select().from(outbox).where(eq(outbox.subject, "Your CareHouse One payment didn't go through"));
    // The PayPal payer and the owner (even before they've accepted their invitation).
    expect(failedMail.map((m) => m.to).sort()).toEqual(["jordan@riverside.test", "payer@example.test"]);

    // A failed payment is a warning; admin features only pause once it's late (on the 10th).
    expect(billingState(after)).toMatchObject({ label: "Payment failed", adminLocked: false });
    expect(billingState({ ...after, lateSince: new Date() })).toMatchObject({ label: "Payment late", adminLocked: true });

    sub("I-GOOD000001", { status: "ACTIVE" });
    await handleWebhook(db, { id: "WH-2", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-GOOD000001" } });
    const [paid] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(paid.pastDueSince).toBeNull();
  });

  it("treats cancelled subscriptions as paused for admin, and invoiced organizations as fine", async () => {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-GOOD000001"));
    expect(billingState({ ...row, status: "CANCELLED" }).adminLocked).toBe(true);
    expect(billingState(null)).toMatchObject({ managed: true, adminLocked: false });
    // Inside a tenant: the demo organization has no subscription, so nothing is paused.
    expect(await withTenant(db, s.orgId, adminLockedMessage)).toBeNull();
  });

  it("invoices on the 29th, reminds on the 5th, and makes an unpaid payment late on the 10th", async () => {
    const at = (iso: string) => new Date(iso);
    const subjects = async (like_: string) => (await db.select().from(outbox).where(like(outbox.subject, like_))).map((m) => m.to).sort();
    // The demo organization (two homes) signed up for one home on November 10: its trial ends
    // December 10, so the first invoice covers December 10 to 28.
    const schedule = scheduleFor(at("2026-11-10T15:00:00Z"));
    // Only this subscription is on the calendar for this test.
    await db.update(subscriptions).set({ status: "CANCELLED" });
    sub("I-DEMO000001", { quantity: "1", billing_info: { failed_payments_count: 0 } });
    const [row] = await db
      .insert(subscriptions)
      .values({ orgId: s.orgId, paypalSubscriptionId: "I-DEMO000001", planId: PLAN, status: "ACTIVE", quantity: 1, payerEmail: "billing@demo.test", syncedAt: at("2030-01-01T00:00:00Z"), ...schedule })
      .returning();
    expect((await orgBill(db, s.orgId)).homes).toBe(2);
    const invoices = () => db.select().from(billingInvoices).where(eq(billingInvoices.subscriptionId, row.id)).orderBy(billingInvoices.periodEnd);
    const sync = () => db.update(subscriptions).set({ syncedAt: at("2030-01-01T00:00:00Z") }).where(eq(subscriptions.id, row.id));

    // Nothing during the trial, or on the 28th itself.
    expect(await runBillingCalendar(db, at("2026-12-28T20:00:00Z"))).toMatchObject({ invoiced: 0 });
    expect(await invoices()).toHaveLength(0);

    // The 29th: PayPal is sent the number of homes. The higher amount needs the payer's approval, so
    // the invoice is for what PayPal will actually take: one home, prorated.
    expect(await runBillingCalendar(db, at("2026-12-29T15:00:00Z"))).toMatchObject({ invoiced: 1 });
    expect(revised.at(-1)).toEqual({ id: "I-DEMO000001", quantity: "2" });
    let [first] = await invoices();
    expect(first).toMatchObject({ periodStart: "2026-12-10", periodEnd: "2026-12-28", stage: "first", homes: 1, perHomeCents: 2940, amountCents: 2940, issuedOn: "2026-12-29", dueOn: "2027-01-05", lateOn: "2027-01-10" });
    const mailed = await db.select().from(outbox).where(like(outbox.subject, "Your CareHouse One invoice: $29.40 due Jan 5"));
    expect(mailed.map((m) => m.to).sort()).toEqual(["billing@demo.test", s.users.owner.email].sort());
    expect(mailed[0].body).toContain("Billing period: Dec 10 to Dec 28, 2026");
    expect(mailed[0].body).toContain("You now have 2 homes");
    // Once per cycle, however often housekeeping runs.
    expect(await runBillingCalendar(db, at("2026-12-29T21:00:00Z"))).toMatchObject({ invoiced: 0 });

    // The 5th: "due today", once.
    await runBillingCalendar(db, at("2027-01-05T13:00:00Z"));
    await runBillingCalendar(db, at("2027-01-05T18:00:00Z"));
    expect(await subjects("%$29.40 is due today")).toHaveLength(2);

    // PayPal takes it: the invoice is paid.
    sub("I-DEMO000001", { quantity: "1", billing_info: { failed_payments_count: 0, outstanding_balance: { value: "0.00" }, last_payment: { amount: { value: "29.40" }, time: "2027-01-05T14:03:00Z" } } });
    await handleWebhook(db, { id: "WH-PAID-1", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-DEMO000001" } }, at("2027-01-05T14:05:00Z"));
    [first] = await invoices();
    expect(first.paidAt?.toISOString()).toBe("2027-01-05T14:03:00.000Z");
    await sync();

    // The next cycle, December 28 to January 28, at the introductory price; the payer approved, so two homes.
    reviseNeedsApproval = false;
    await runBillingCalendar(db, at("2027-01-29T15:00:00Z"));
    let second = (await invoices())[1];
    expect(second).toMatchObject({ periodStart: "2026-12-28", periodEnd: "2027-01-28", stage: "intro", homes: 2, amountCents: 9800, dueOn: "2027-02-05", lateOn: "2027-02-10" });

    // February 5th's payment fails: a warning, nothing paused yet.
    sub("I-DEMO000001", { quantity: "2", billing_info: { failed_payments_count: 1, outstanding_balance: { value: "98.00" }, last_payment: { time: "2027-01-05T14:03:00Z" } } });
    await handleWebhook(db, { id: "WH-FAIL-1", event_type: "BILLING.SUBSCRIPTION.PAYMENT.FAILED", resource: { id: "I-DEMO000001" } }, at("2027-02-05T15:00:00Z"));
    const [failed] = await db.select().from(outbox).where(and(eq(outbox.to, "billing@demo.test"), eq(outbox.subject, "Your CareHouse One payment didn't go through")));
    expect(failed.body).toContain("Wednesday, February 10");
    let [state] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(billingState(state, at("2027-02-06T15:00:00Z"))).toMatchObject({ label: "Payment failed", adminLocked: false });

    // Still unpaid on the 10th: late, a late fee invoiced through PayPal, admin features paused.
    expect(await runBillingCalendar(db, at("2027-02-10T15:00:00Z"))).toMatchObject({ late: 1 });
    second = (await invoices())[1];
    expect(second).toMatchObject({ lateFeeCents: 2500, lateFeeInvoiceId: "INV2-TEST-0001" });
    expect(feeInvoices).toEqual([{ email: "billing@demo.test", value: "25.00" }]);
    expect(await subjects("Your CareHouse One payment is late")).toEqual(["billing@demo.test", s.users.owner.email].sort());
    expect(await withTenant(db, s.orgId, adminLockedMessage)).toMatch(/paused/);
    expect(await runBillingCalendar(db, at("2027-02-10T20:00:00Z"))).toMatchObject({ late: 0 });

    // PayPal's retry goes through: paid, and admin features come back.
    sub("I-DEMO000001", { quantity: "2", billing_info: { failed_payments_count: 0, outstanding_balance: { value: "0" }, last_payment: { time: "2027-02-11T09:00:00Z" } } });
    await handleWebhook(db, { id: "WH-PAID-2", event_type: "PAYMENT.SALE.COMPLETED", resource: { billing_agreement_id: "I-DEMO000001" } }, at("2027-02-11T09:05:00Z"));
    [state] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(state.lateSince).toBeNull();
    expect((await invoices())[1].paidAt).not.toBeNull();
    expect(await withTenant(db, s.orgId, adminLockedMessage)).toBeNull();

    // The organization sees its own subscription and invoices, and can't write them.
    const seen = await withTenant(db, s.orgId, (tx) => tx.select().from(subscriptions));
    expect(seen.map((x) => x.paypalSubscriptionId)).toEqual(["I-DEMO000001"]);
    expect((await withTenant(db, s.orgId, orgInvoices)).map((i) => i.periodEnd)).toEqual(["2027-01-28", "2026-12-28"]);
    const write = await withTenant(db, s.orgId, (tx) => tx.update(billingInvoices).set({ amountCents: 1 })).then(
      () => "written",
      () => "refused",
    );
    expect(write).toBe("refused");
  });

  it("after a cancellation, bills the last cycle and anything unpaid as PayPal invoices", async () => {
    // Continues the demo organization's subscription from the test above (paid up through February).
    const at = (iso: string) => new Date(iso);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-DEMO000001"));
    const invoices = () => db.select().from(billingInvoices).where(eq(billingInvoices.subscriptionId, row.id)).orderBy(billingInvoices.periodEnd);
    const mail = async (subject: string) => db.select().from(outbox).where(and(eq(outbox.to, "billing@demo.test"), like(outbox.subject, subject)));
    const paid = { failed_payments_count: 0, outstanding_balance: { value: "0" }, last_payment: { time: "2027-02-11T09:00:00Z" } };

    // March 1: the invoice for January 28 to February 28 goes out as usual, due March 5.
    await runBillingCalendar(db, at("2027-03-01T15:00:00Z"));
    expect((await invoices())[2]).toMatchObject({ periodEnd: "2027-02-28", amountCents: 9800, dueOn: "2027-03-05", paypalInvoiceId: null });

    // March 3: the client cancels in PayPal. PayPal won't take March 5th's payment, so that invoice
    // goes out as a PayPal invoice; the cycle running now (to March 28) is the last one.
    sub("I-DEMO000001", { quantity: "2", status: "CANCELLED", status_update_time: "2027-03-03T16:00:00Z", billing_info: paid });
    await handleWebhook(db, { id: "WH-CANCEL-1", event_type: "BILLING.SUBSCRIPTION.CANCELLED", resource: { id: "I-DEMO000001" } }, at("2027-03-03T16:01:00Z"));
    let [state] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(state.cancelledOn).toBe("2027-03-03");
    let third = (await invoices())[2];
    expect(third.paypalInvoiceId).toMatch(/^INV2-TEST-/);
    expect(sentInvoices.at(-1)).toMatchObject({ id: third.paypalInvoiceId, email: "billing@demo.test", quantity: "2", value: "49.00", dueOn: "2027-03-05" });
    const [cancelled] = await mail("Your CareHouse One subscription is cancelled");
    expect(cancelled.body).toContain("until the current billing cycle ends on Sunday, March 28");
    expect(cancelled.body).toContain("on Monday, March 29 PayPal will email you an invoice for it, due Monday, April 5");
    expect(cancelled.body).toContain("$98, due Mar 5, 2027");
    // Everything keeps working until the cycle ends, then admin features pause.
    expect(billingState(state, at("2027-03-10T15:00:00Z"))).toMatchObject({ label: "Cancelled", adminLocked: false });
    expect(billingState(state, at("2027-03-28T15:00:00Z"))).toMatchObject({ label: "Cancelled", adminLocked: true });

    // March 5: the reminder says to pay the PayPal invoice; then the client pays it.
    await runBillingCalendar(db, at("2027-03-05T13:00:00Z"));
    expect((await mail("%$98 is due today")).at(-1)?.body).toContain("please pay the invoice PayPal emailed you");
    invoiceStatus.set(third.paypalInvoiceId!, "PAID");
    await handleWebhook(db, { id: "WH-INV-PAID-1", event_type: "INVOICING.INVOICE.PAID", resource: { invoice: { id: third.paypalInvoiceId! } } }, at("2027-03-06T10:00:00Z"));
    third = (await invoices())[2];
    expect(third.paidAt?.toISOString()).toBe("2027-03-06T10:00:00.000Z");

    // March 29: the final invoice, for the homes there are now, as a PayPal invoice. PayPal's
    // subscription isn't touched.
    const revisions = revised.length;
    expect(await runBillingCalendar(db, at("2027-03-29T15:00:00Z"))).toMatchObject({ invoiced: 1 });
    expect(revised).toHaveLength(revisions);
    const final = (await invoices())[3];
    expect(final).toMatchObject({ periodStart: "2027-02-28", periodEnd: "2027-03-28", homes: 2, amountCents: 9800, dueOn: "2027-04-05", lateOn: "2027-04-10" });
    expect(sentInvoices.at(-1)).toMatchObject({ id: final.paypalInvoiceId, quantity: "2", value: "49.00", dueOn: "2027-04-05" });
    expect((await mail("Your final CareHouse One invoice: $98 due Apr 5"))[0].body).toContain("This is your final invoice");

    // Unpaid on April 10: late, with a late fee. Paid later: settled.
    expect(await runBillingCalendar(db, at("2027-04-10T15:00:00Z"))).toMatchObject({ late: 1 });
    expect((await mail("Your CareHouse One payment is late")).at(-1)?.body).toContain("please pay the PayPal invoice we sent");
    invoiceStatus.set(final.paypalInvoiceId!, "MARKED_AS_PAID");
    await handleWebhook(db, { id: "WH-INV-PAID-2", event_type: "INVOICING.INVOICE.PAID", resource: { id: final.paypalInvoiceId! } }, at("2027-04-12T10:00:00Z"));
    expect((await invoices())[3].paidAt).not.toBeNull();
    [state] = await db.select().from(subscriptions).where(eq(subscriptions.id, row.id));
    expect(state.lateSince).toBeNull();
    // Nothing after that.
    expect(await runBillingCalendar(db, at("2027-04-29T15:00:00Z"))).toMatchObject({ invoiced: 0 });
    expect(await invoices()).toHaveLength(4);
    // An invoice ID PayPal sends that isn't ours is ignored.
    expect(await handleWebhook(db, { id: "WH-INV-OTHER", event_type: "INVOICING.INVOICE.PAID", resource: { id: "INV2-NOT-OURS" } })).toBe("ignored");
  });
});

describe("billing calendar", () => {
  it("bills a cancelled subscription to the end of the cycle it was cancelled in, and nothing in the trial", () => {
    const sched = scheduleFor(new Date("2026-11-10T15:00:00Z"));
    expect(finalCycleEnd(sched, "2026-11-20")).toBeNull();
    expect(finalCycleEnd(sched, sched.trialEndsOn)).toBeNull();
    expect(finalCycleEnd(sched, "2026-12-11")).toBe("2026-12-28");
    expect(finalCycleEnd(sched, "2027-01-28")).toBe("2027-01-28");
    expect(finalCycleEnd(sched, "2027-01-29")).toBe("2027-02-28");
  });

  it("is free for 30 days, then $49 per home for 3 months, then $99 per home", () => {
    expect(monthlyBill(1, "trial").total).toBe(0);
    expect(monthlyBill(3, "intro")).toEqual({ homes: 3, stage: "intro", perHome: 49, total: 147 });
    expect(monthlyBill(3)).toEqual({ homes: 3, stage: "regular", perHome: 99, total: 297 });
    // An organization is never billed for less than one home.
    expect(monthlyBill(0).total).toBe(99);
  });

  it("runs from the 28th to the 28th, prorates the first cycle, and charges on the 5th", () => {
    // Signed up November 10 (Central time, even late in the evening): free until December 10, then
    // 18 of the 30 days of the cycle to December 28 at $49, charged January 5.
    const s1 = scheduleFor(new Date("2026-11-10T15:00:00Z"));
    expect(s1).toEqual({ trialEndsOn: "2026-12-10", firstCycleEnd: "2026-12-28", firstPerHomeCents: 2940, introCycles: 3, startsOn: "2027-01-05" });
    expect(scheduleFor(new Date("2026-11-11T03:00:00Z"))).toEqual(s1);
    // A trial that ends after the 28th runs to the 28th of the next month (30 of 31 days).
    expect(scheduleFor(new Date("2026-11-29T15:00:00Z"))).toEqual({ trialEndsOn: "2026-12-29", firstCycleEnd: "2027-01-28", firstPerHomeCents: 4742, introCycles: 3, startsOn: "2027-02-05" });
    // One that ends on the 28th starts a whole cycle, which is the first introductory month.
    expect(scheduleFor(new Date("2026-10-29T15:00:00Z"))).toEqual({ trialEndsOn: "2026-11-28", firstCycleEnd: "2026-12-28", firstPerHomeCents: 4900, introCycles: 2, startsOn: "2027-01-05" });

    expect(cycleEnding(s1, "2026-11-28")).toBeNull();
    expect(cycleEnding(s1, "2026-12-28")).toMatchObject({ index: 1, start: "2026-12-10", stage: "first", perHomeCents: 2940, invoiceOn: "2026-12-29", dueOn: "2027-01-05", lateOn: "2027-01-10" });
    expect(cycleEnding(s1, "2027-03-28")).toMatchObject({ index: 4, start: "2027-02-28", stage: "intro", perHomeCents: 4900 });
    expect(cycleEnding(s1, "2027-04-28")).toMatchObject({ index: 5, stage: "regular", perHomeCents: 9900 });
    // After February the invoice goes out on March 1st.
    expect(invoiceDay("2027-02-28")).toBe("2027-03-01");
    expect(dueDay("2027-12-28")).toBe("2028-01-05");
    // The cycle running on a day: the 28th starts a new one.
    expect(cycleOn(s1, "2026-11-20").end).toBe("2026-12-28");
    expect(cycleOn(s1, "2027-01-27").end).toBe("2027-01-28");
    expect(cycleOn(s1, "2027-01-28").end).toBe("2027-02-28");

    // What PayPal is told, and checking it back.
    const terms = paypalTerms(s1);
    expect(terms).toEqual({
      start_time: "2027-01-05T14:00:00.000Z",
      plan: { billing_cycles: [{ sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: "29.40", currency_code: "USD" } } }, { sequence: 2, total_cycles: 3 }] },
    });
    const paypalCopy = { id: "I-X", plan_id: PLAN, status: "ACTIVE", create_time: "2026-11-10T15:00:05Z", start_time: "2027-01-05T14:00:00Z", plan: terms.plan };
    expect(confirmTerms(paypalCopy)).toEqual(s1);
    expect(confirmTerms({ ...paypalCopy, start_time: "2027-02-05T14:00:00Z" })).toBeNull();
    expect(cents(2940)).toBe("$29.40");
    expect(cents(9800)).toBe("$98");
    expect(dayIn(new Date("2026-11-11T03:00:00Z"))).toBe("2026-11-10");
  });
});

describe("new setup link on request", () => {
  it("emails a fresh link for an unfinished sign-up, and nothing for one that's set up", async () => {
    sub("I-LATE000001", { subscriber: { email_address: "late@example.test" } });
    expect((await registerSubscription(db, "I-LATE000001", APP)).ok).toBe(true);
    const count = async (to: string) => (await db.select().from(outbox).where(eq(outbox.to, to))).length;
    const before = await count("late@example.test");
    await resendSetupLink(db, "LATE@example.test", APP);
    const mails = await db.select().from(outbox).where(eq(outbox.to, "late@example.test"));
    expect(mails.length).toBe(before + 1);
    const link = mails[mails.length - 1].body.match(/\/setup\/([\w-]+)/)![1];
    expect(await describeSetup(db, link)).toMatchObject({ payerEmail: "late@example.test" });

    // payer@example.test's only sign-up (Riverside) is already an organization: no link.
    await resendSetupLink(db, "payer@example.test", APP);
    const resent = (await db.select().from(outbox).where(eq(outbox.to, "payer@example.test"))).filter((m) => m.subject === "Your new CareHouse One setup link");
    expect(resent).toHaveLength(0);
  });
});

describe("trial ending reminder", () => {
  const DAY = 86_400_000;
  const trialMail = () => db.select().from(outbox).where(like(outbox.subject, "Your CareHouse One free trial ends%"));
  // Pretend the subscription started `days` ago, and stop the 6-hourly refresh from touching it.
  const age = (id: string, days: number, now: Date) => {
    const createdAt = new Date(now.getTime() - days * DAY);
    return db.update(subscriptions).set({ createdAt, ...scheduleFor(createdAt), syncedAt: now }).where(eq(subscriptions.paypalSubscriptionId, id));
  };

  it("emails the billing contacts 2 or 3 days before the trial ends, once", async () => {
    const now = new Date();
    sub("I-TRIAL00001");
    const r = await registerSubscription(db, "I-TRIAL00001", APP);
    if (!r.ok) throw new Error(r.error);
    expect((await completeSetup(db, tokenFrom(r.setupUrl), { ...setupInput("lee@trialhomes.test"), orgName: "Trial Homes" }, APP)).ok).toBe(true);

    await age("I-TRIAL00001", 10, now);
    await syncSubscriptions(db, now);
    expect(await trialMail()).toHaveLength(0);

    await age("I-TRIAL00001", 28, now);
    const before = (await trialMail()).length;
    const result = await syncSubscriptions(db, now);
    expect(result.reminded).toBeGreaterThanOrEqual(1);
    const mails = (await trialMail()).slice(before);
    expect(mails.map((m) => m.to).sort()).toEqual(["lee@trialhomes.test", "payer@example.test"]);
    expect(mails[0].body).toContain("standard billing cycle, which runs from the 28th of one month to the 28th of the next");
    expect(mails[0].body).toMatch(/Your first invoice, on \w+day, \w+ \d+, covers .+: 1 home × \$[\d.]+ = \$[\d.]+/);
    expect(mails[0].body).toContain("then $99 per home a month");
    expect(mails[0].body).toContain("Automatic payments");
    expect(mails[0].body).not.toContain("/setup/");

    await syncSubscriptions(db, new Date(now.getTime() + 3_600_000));
    expect((await trialMail()).length).toBe(before + 2);
  });

  it("sends a fresh setup link to someone who paid but never set up", async () => {
    const now = new Date();
    sub("I-NOSETUP001");
    expect((await registerSubscription(db, "I-NOSETUP001", APP)).ok).toBe(true);
    await age("I-NOSETUP001", 28, now);
    const before = (await trialMail()).length;
    await syncSubscriptions(db, now);
    const [mail] = (await trialMail()).slice(before);
    expect(mail.to).toBe("payer@example.test");
    const link = mail.body.match(/\/setup\/([\w-]+)/)?.[1];
    expect(link).toBeTruthy();
    expect(await describeSetup(db, link!)).not.toBeNull();
  });
});

describe("demo requests", () => {
  it("stores a valid request and notifies the team", async () => {
    vi.stubEnv("LEADS_EMAIL", "team@carehouseone.test");
    expect((await createLead(db, { name: "A", email: "x", organization: "Y" })).ok).toBe(false);
    expect((await createLead(db, { name: "Sam Ortiz", email: "sam@homes.test", organization: "Ortiz Care Homes", homes: "3", residents: "18" })).ok).toBe(true);
    const [lead] = await db.select().from(leads);
    expect(lead).toMatchObject({ organization: "Ortiz Care Homes", homes: 3, residents: 18 });
    expect((await db.select().from(outbox).where(eq(outbox.to, "team@carehouseone.test"))).length).toBe(1);
  });

  it("isn't readable by any organization", async () => {
    const r = await withTenant(db, s.orgId, (tx) => tx.select().from(leads)).then(
      () => "readable",
      () => "refused",
    );
    expect(r).toBe("refused");
  });
});
