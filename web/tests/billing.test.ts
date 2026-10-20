import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, billingEvents, leads, organizations, outbox, subscriptions } from "@/db/schema";
import { describeToken } from "@/server/auth";
import { adminLockedMessage, billingState, completeSetup, describeSetup, handleWebhook, registerSubscription, resendSetupLink, syncSubscriptions } from "@/server/billing";
import { createLead } from "@/server/leads";
import { resetPaypalToken } from "@/server/paypal";
import { seedCare, seedDemo, type Seeded } from "@/server/seed";

const APP = "https://app.example.test";
const PLAN = "P-TESTPLAN123";
let db: DB;
let s: Seeded;

// A tiny stand-in for PayPal's API: subscriptions by ID, and what revise returns.
const paypal = new Map<string, Record<string, unknown>>();
const revised: Array<{ id: string; quantity: string }> = [];

function stubPaypal() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/v1/oauth2/token")) return json({ access_token: "test-token", expires_in: 3600 });
    const rev = u.match(/\/v1\/billing\/subscriptions\/([^/]+)\/revise$/);
    if (rev) {
      revised.push({ id: rev[1], quantity: JSON.parse(String(init?.body)).quantity });
      return json({ links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/approve/x" }] });
    }
    const get = u.match(/\/v1\/billing\/subscriptions\/([^/?]+)$/);
    if (get) return paypal.has(get[1]) ? json(paypal.get(get[1])) : json({ name: "RESOURCE_NOT_FOUND" }, 404);
    return json({}, 404);
  });
}

const sub = (id: string, extra: Record<string, unknown> = {}) =>
  paypal.set(id, {
    id,
    plan_id: PLAN,
    status: "ACTIVE",
    quantity: "6",
    subscriber: { email_address: "Payer@Example.test", name: { given_name: "Jordan", surname: "Lee" } },
    billing_info: { next_billing_time: "2026-11-16T10:00:00Z", failed_payments_count: 0 },
    ...extra,
  });

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
    expect(await describeSetup(db, token)).toMatchObject({ payerEmail: "payer@example.test", payerName: "Jordan Lee", quantity: 6 });
    const [mail] = await db.select().from(outbox).where(eq(outbox.to, "payer@example.test"));
    expect(mail.body).toContain(r.setupUrl);

    const notAccepted = await completeSetup(db, token, { ...setupInput("jordan@riverside.test"), accepted: false }, APP);
    expect(!notAccepted.ok && notAccepted.error).toMatch(/Accept the Terms/);

    const done = await completeSetup(db, token, setupInput("jordan@riverside.test"), APP);
    expect(done.ok).toBe(true);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-GOOD000001"));
    expect(row.orgId).not.toBeNull();
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

  it("refuses other plans, unapproved subscriptions and made-up IDs", async () => {
    sub("I-OTHERPLAN1", { plan_id: "P-SOMETHINGELSE" });
    sub("I-PENDING001", { status: "APPROVAL_PENDING" });
    expect((await registerSubscription(db, "I-OTHERPLAN1", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "I-PENDING001", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "I-NOTREAL0001", APP)).ok).toBe(false);
    expect((await registerSubscription(db, "../../v1/oauth2", APP)).ok).toBe(false);
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

    // Within 14 days admin features still work; after that they pause. Care records never do.
    expect(billingState(after).adminLocked).toBe(false);
    expect(billingState(after, new Date(after.pastDueSince!.getTime() + 15 * 86_400_000)).adminLocked).toBe(true);

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

  it("sends the active resident count to PayPal on the first of the month", async () => {
    // Attach a subscription to the demo organization, which has active residents.
    sub("I-DEMO000001", { quantity: "1" });
    await db.insert(subscriptions).values({ orgId: s.orgId, paypalSubscriptionId: "I-DEMO000001", planId: PLAN, status: "ACTIVE", quantity: 1 });
    await syncSubscriptions(db, new Date("2026-11-01T12:00:00Z"));
    const demo = revised.find((r) => r.id === "I-DEMO000001");
    expect(Number(demo?.quantity)).toBeGreaterThan(1);
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, "I-DEMO000001"));
    expect(row.quantitySyncedMonth).toBe("2026-11");
    expect(row.approvalUrl).toMatch(/approve/);
    // Only once a month.
    revised.length = 0;
    await syncSubscriptions(db, new Date("2026-11-01T18:00:00Z"));
    expect(revised).toEqual([]);
    // The organization only ever sees its own subscription.
    const seen = await withTenant(db, s.orgId, (tx) => tx.select().from(subscriptions));
    expect(seen.map((x) => x.paypalSubscriptionId)).toEqual(["I-DEMO000001"]);
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
  const age = (id: string, days: number, now: Date) =>
    db.update(subscriptions).set({ createdAt: new Date(now.getTime() - days * DAY), nextBillingAt: null, syncedAt: now }).where(eq(subscriptions.paypalSubscriptionId, id));

  it("emails the billing contacts 3 days before the first payment, once", async () => {
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
    expect(mails[0].body).toContain("$300");
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
