import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { adminAudit, billingInvoices, contracts, leads, outbox, platformAdmins, subscriptions, users } from "@/db/schema";
import { cycleEnding, scheduleStarting } from "@/lib/billing-cycle";
import { decrypt } from "@/lib/crypto";
import { currentTotp } from "@/lib/totp";
import { adminSignIn, adminVerify, completeAdminSetup, createAdmin, describeAdminSetup, getAdmin } from "@/server/admin-auth";
import { clientDetail, createClient, dashboard, listClients, resendOwnerInvite, updateLead } from "@/server/admin";
import { billingState, cancelBilling, markInvoicePaid, runBillingCalendar, startInvoiceBilling } from "@/server/billing";
import { contractByToken, remindContract, renderContractPdf, sendContract, signContract, voidContract } from "@/server/contracts";
import { createLead } from "@/server/leads";
import { resetPaypalToken } from "@/server/paypal";

const APP = "https://app.example.test";
let db: DB;
let adminId: string;
let orgId: string;

// PayPal's invoicing API, just enough for invoices to go out.
const sent: Array<{ email: string; quantity: string; value: string; dueOn?: string }> = [];
function stubPaypal() {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const u = String(url);
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/v1/oauth2/token")) return json({ access_token: "t", expires_in: 3600 });
    if (u.endsWith("/v2/invoicing/invoices")) {
      const b = JSON.parse(String(init?.body));
      sent.push({ email: b.primary_recipients[0].billing_info.email_address, quantity: b.items[0].quantity, value: b.items[0].unit_amount.value, dueOn: b.detail.payment_term.due_date });
      return json({ id: `INV2-ADMN-${String(sent.length).padStart(4, "0")}` }, 201);
    }
    if (/\/v2\/invoicing\/invoices\/INV2-[A-Z0-9-]+\/send$/.test(u)) return json({}, 202);
    return json({}, 404);
  });
}

const tokenIn = (body: string, path: string) => body.split(`${path}/`)[1].split(/\s/)[0];

beforeAll(async () => {
  db = await createTestDb();
  stubPaypal();
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  resetPaypalToken();
  vi.stubEnv("PAYPAL_CLIENT_ID", "client");
  vi.stubEnv("PAYPAL_CLIENT_SECRET", "secret");
  vi.stubEnv("PAYPAL_PLAN_ID", "P-TEST");
});

describe("admin accounts", () => {
  it("sets up with a password and an authenticator, then signs in with both", async () => {
    const token = await createAdmin(db, "Me@CareHouse.test", "Admin Person");
    const setup = await describeAdminSetup(db, token);
    expect(setup?.email).toBe("me@carehouse.test");
    expect(await completeAdminSetup(db, token, "short", "000000")).toMatchObject({ ok: false });
    expect(await completeAdminSetup(db, token, "a long admin passphrase 2026", "000000")).toMatchObject({ ok: false, error: expect.stringMatching(/code/) });
    expect(await completeAdminSetup(db, token, "a long admin passphrase 2026", await currentTotp(setup!.secret))).toEqual({ ok: true });
    // The link works once.
    expect(await describeAdminSetup(db, token)).toBeNull();

    expect(await adminSignIn(db, "me@carehouse.test", "wrong password here")).toMatchObject({ ok: false });
    const step1 = await adminSignIn(db, "me@carehouse.test", "a long admin passphrase 2026");
    expect(step1.ok).toBe(true);
    if (!step1.ok) return;
    // Not signed in until the code is entered.
    expect(await getAdmin(db, step1.token)).toBeNull();
    const [a] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, "me@carehouse.test"));
    expect(await adminVerify(db, step1.token, await currentTotp(decrypt(a.mfaSecretEnc)))).toMatchObject({ ok: true });
    const me = await getAdmin(db, step1.token);
    expect(me).toMatchObject({ email: "me@carehouse.test", name: "Admin Person" });
    adminId = me!.id;
    expect((await db.select().from(adminAudit).where(eq(adminAudit.action, "admin_sign_in"))).length).toBe(1);
  });

  it("locks after five wrong passwords", async () => {
    for (let i = 0; i < 5; i++) await adminSignIn(db, "me@carehouse.test", `wrong password ${i}`);
    expect(await adminSignIn(db, "me@carehouse.test", "a long admin passphrase 2026")).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    await db.update(platformAdmins).set({ lockedUntil: null, failedLogins: 0 });
  });
});

describe("clients", () => {
  it("creates a client from a lead and shows its setup", async () => {
    await createLead(db, { name: "Pat Rivera", email: "pat@riverside.test", organization: "Riverside Homes", homes: "2" });
    const [lead] = await db.select().from(leads);
    const r = await createClient(db, adminId, { orgName: "Riverside Homes", homes: [{ name: "Oak House", timeZone: "America/Chicago" }, { name: "Elm House", timeZone: "America/Chicago" }], owner: { name: "Pat Rivera", email: "pat@riverside.test" } }, APP, lead.id, { holdInvite: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    orgId = r.orgId;
    const [won] = await db.select().from(leads);
    expect(won).toMatchObject({ status: "won", orgId });
    const [row] = (await listClients(db)).filter((c) => c.id === orgId);
    expect(row).toMatchObject({ homes: 2, ownerStatus: "invited", method: null, contract: "none" });
    // The owner's invitation is held until the contract is signed.
    const [owner] = await db.select().from(users).where(eq(users.orgId, orgId));
    expect((await db.select().from(outbox).where(eq(outbox.to, "pat@riverside.test"))).length).toBe(0);
    expect((await clientDetail(db, orgId))?.held).toEqual([owner.id]);
    expect(await updateLead(db, adminId, lead.id, { status: "nope", notes: "" })).toMatchObject({ ok: false });
  });
});

describe("contracts", () => {
  it("sends an order form to sign; signing starts billing by PayPal invoice", async () => {
    const now = new Date("2026-11-11T16:00:00Z");
    expect(await sendContract(db, adminId, orgId, { signerName: "Pat Rivera", signerEmail: "pat@riverside.test", homes: 2 }, APP, now)).toMatchObject({ ok: false, error: expect.stringMatching(/billing starts/) });
    const r = await sendContract(db, adminId, orgId, { signerName: "Pat Rivera", signerEmail: "pat@riverside.test", homes: 2, startsOn: "2026-12-01", introMonths: 3, note: "Onboarding call included." }, APP, now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [mail] = await db.select().from(outbox).where(like(outbox.subject, "Your CareHouse One agreement is ready to sign"));
    const token = tokenIn(mail.body, "/contract");
    expect(r.link).toBe(`${APP}/contract/${token}`);

    const c = await contractByToken(db, token, now);
    expect(c?.viewedAt).not.toBeNull();
    const doc = c!.document as { order: Array<{ label: string; text: string }>; billing: string };
    expect(doc.billing).toBe("paypal_invoice");
    expect(doc.order.find((l) => l.label === "Billing starts")?.text).toContain("Dec 1 to Dec 28, 2026 at $44.10 per home");
    expect(doc.order.find((l) => l.label === "Other terms")?.text).toBe("Onboarding call included.");

    // Resending replaces the link.
    const again = await remindContract(db, adminId, c!.id, APP, now);
    expect(again.ok).toBe(true);
    expect(await contractByToken(db, token, now)).toBeNull();
    const fresh = again.ok ? again.link.split("/contract/")[1] : "";

    expect(await signContract(db, fresh, { name: "Pat Rivera", title: "Owner", method: "typed", consent: false }, { ip: "203.0.113.5", appUrl: APP }, now)).toMatchObject({ ok: false });
    expect(await signContract(db, fresh, { name: "Pat Rivera", title: "Owner", method: "drawn", image: "javascript:alert(1)", consent: true }, { ip: "203.0.113.5", appUrl: APP }, now)).toMatchObject({ ok: false });
    expect(await signContract(db, fresh, { name: "Pat Rivera", title: "Owner", method: "typed", consent: true }, { ip: "203.0.113.5", userAgent: "test", appUrl: APP }, now)).toEqual({ ok: true });
    expect(await signContract(db, fresh, { name: "Pat Rivera", title: "Owner", method: "typed", consent: true }, { ip: "203.0.113.5", appUrl: APP }, now)).toMatchObject({ ok: false });

    const [signed] = await db.select().from(contracts).where(eq(contracts.id, c!.id));
    expect(signed).toMatchObject({ status: "signed", signedName: "Pat Rivera", signedTitle: "Owner", signerIp: "203.0.113.5" });
    expect(signed.documentHash).toMatch(/^[0-9a-f]{64}$/);
    const pdf = await renderContractPdf(signed);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    // Billing by PayPal invoice started on the order form's terms.
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
    expect(sub).toMatchObject({ billingMethod: "invoice", paypalSubscriptionId: null, payerEmail: "pat@riverside.test", trialEndsOn: "2026-12-01", firstCycleEnd: "2026-12-28", introCycles: 3 });
    expect(billingState(sub, now).label).toBe("Billing starts Dec 1, 2026");
    const [notice] = await db.select().from(outbox).where(like(outbox.subject, "Contract signed: Riverside Homes"));
    expect(notice.to).toBe("me@carehouse.test");
    expect(notice.body).toContain("Pat Rivera (pat@riverside.test) was emailed an invitation");
    // Signing sent the held invitation, once.
    const invites = await db.select().from(outbox).where(like(outbox.subject, "Your CareHouse One account is ready"));
    expect(invites.map((m) => m.to)).toEqual(["pat@riverside.test"]);
    expect(invites[0].body).toContain(`${APP}/invite/`);
    expect((await clientDetail(db, orgId))?.held).toEqual([]);
    // A replacement link from the admin site still works.
    const [owner] = await db.select().from(users).where(eq(users.orgId, orgId));
    expect(await resendOwnerInvite(db, adminId, orgId, owner.id, APP)).toMatchObject({ ok: true });

    // A second order form would set up billing twice.
    const other = await sendContract(db, adminId, orgId, { signerName: "Pat Rivera", signerEmail: "pat@riverside.test", homes: 2, startsOn: "2026-12-01" }, APP, now);
    expect(other).toMatchObject({ ok: false, error: expect.stringMatching(/already billed/) });
  });

  it("can't be withdrawn once signed", async () => {
    const [signed] = await db.select().from(contracts).where(eq(contracts.status, "signed"));
    expect(await voidContract(db, adminId, signed.id)).toMatchObject({ ok: false });
  });
});

describe("billing by PayPal invoice", () => {
  it("issues each invoice as a PayPal invoice, with no subscription to charge", async () => {
    const at = (iso: string) => new Date(iso);
    expect(await runBillingCalendar(db, at("2026-12-29T15:00:00Z"))).toMatchObject({ invoiced: 1 });
    const [inv] = await db.select().from(billingInvoices).where(eq(billingInvoices.orgId, orgId));
    expect(inv).toMatchObject({ periodStart: "2026-12-01", periodEnd: "2026-12-28", homes: 2, perHomeCents: 4410, amountCents: 8820, dueOn: "2027-01-05" });
    expect(inv.paypalInvoiceId).toMatch(/^INV2-ADMN-/);
    expect(sent.at(-1)).toEqual({ email: "pat@riverside.test", quantity: "2", value: "44.10", dueOn: "2027-01-05" });
    const [mail] = await db.select().from(outbox).where(like(outbox.subject, "Your CareHouse One invoice: $88.20 due Jan 5"));
    expect(mail.body).toContain("PayPal is emailing you an invoice for this amount; you can pay it by card or with PayPal");

    // Paid by check: marked paid by hand.
    expect(await markInvoicePaid(db, inv.id, "check #1042", at("2027-01-04T15:00:00Z"))).toEqual({ ok: true });
    expect(await markInvoicePaid(db, inv.id, "again")).toMatchObject({ ok: false });

    const detail = await clientDetail(db, orgId);
    expect(detail?.invoices).toHaveLength(1);
    expect((await dashboard(db, at("2027-01-10T15:00:00Z"))).monthlyCents).toBe(2 * 4900);

    // Cancelling: the cycle running today is the last one billed.
    expect(await cancelBilling(db, orgId, "closing", at("2027-01-15T15:00:00Z"))).toEqual({ ok: true });
    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
    expect(sub).toMatchObject({ status: "CANCELLED", cancelledOn: "2027-01-15" });
    expect(await runBillingCalendar(db, at("2027-01-29T15:00:00Z"))).toMatchObject({ invoiced: 1 });
    expect(await runBillingCalendar(db, at("2027-02-28T15:00:00Z"))).toMatchObject({ invoiced: 0 });
    expect(await cancelBilling(db, orgId, "again")).toMatchObject({ ok: false });
  });

  it("refuses bad billing setups", async () => {
    expect(await startInvoiceBilling(db, orgId, { billingEmail: "x@y.test", startsOn: "2027-01-01", introMonths: 3 })).toMatchObject({ ok: false });
    expect(await startInvoiceBilling(db, orgId, { billingEmail: "not an email", startsOn: "2027-01-01", introMonths: 3 })).toMatchObject({ ok: false });
  });

  it("schedules from any start day, with or without introductory months", () => {
    expect(scheduleStarting("2026-12-28", 3)).toMatchObject({ firstCycleEnd: "2027-01-28", introCycles: 2, firstPerHomeCents: 4900 });
    expect(scheduleStarting("2026-12-28", 0)).toMatchObject({ introCycles: 0, firstPerHomeCents: 9900 });
    const s = scheduleStarting("2026-12-15", 0);
    expect(cycleEnding(s, "2027-01-28")?.perHomeCents).toBe(9900);
    expect(s.firstPerHomeCents).toBe(Math.round((9900 * 13) / 30));
  });
});

describe("admin data stays away from organizations", () => {
  it("isn't readable from inside a tenant", async () => {
    const refused = (run: Promise<unknown>) => run.then(() => "read", () => "refused");
    expect(await refused(withTenant(db, orgId, (tx) => tx.select().from(contracts)))).toBe("refused");
    expect(await refused(withTenant(db, orgId, (tx) => tx.select().from(platformAdmins)))).toBe("refused");
    expect(await refused(withTenant(db, orgId, (tx) => tx.select().from(adminAudit)))).toBe("refused");
  });
});
