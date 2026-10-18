import { and, count, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { billingEvents, residents, subscriptions, users, type Subscription } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { audit, sendMail } from "./audit";
import { getSubscription, paypalConfigured, reviseQuantity, TRIAL_DAYS, type PaypalSubscription } from "./paypal";
import { provisionOrganization, provisionSchema } from "./provision";

export const SETUP_DAYS = 7;
export const READ_ONLY_AFTER_DAYS = 14;
const DAY = 86_400_000;

/** Self-service sign-up stays closed until the customer BAA and terms are final (SIGNUP_OPEN=true). */
export function signupOpen(): boolean {
  return process.env.SIGNUP_OPEN === "true" && paypalConfigured();
}

function fromPaypal(p: PaypalSubscription, now: Date) {
  const failed = p.billing_info?.failed_payments_count ?? 0;
  return {
    status: p.status,
    quantity: Math.max(1, Number(p.quantity ?? 1) || 1),
    payerEmail: p.subscriber?.email_address?.toLowerCase() ?? null,
    payerName: [p.subscriber?.name?.given_name, p.subscriber?.name?.surname].filter(Boolean).join(" ") || null,
    nextBillingAt: p.billing_info?.next_billing_time ? new Date(p.billing_info.next_billing_time) : null,
    failedPayments: failed,
    syncedAt: now,
    behind: p.status === "SUSPENDED" || failed > 0,
  };
}

/**
 * Step 1 of sign-up, after the buyer approves the subscription in the PayPal window: confirm it
 * with PayPal (never trust the browser), record it, and email a single-use setup link.
 */
export async function registerSubscription(db: DB, subscriptionId: string, appUrl: string, now = new Date()): Promise<{ ok: true; setupUrl: string } | { ok: false; error: string }> {
  if (!signupOpen()) return { ok: false, error: "Sign-up isn't open yet." };
  let p: PaypalSubscription;
  try {
    p = await getSubscription(subscriptionId);
  } catch {
    return { ok: false, error: "We couldn't confirm the subscription with PayPal. Try again in a minute." };
  }
  if (p.plan_id !== process.env.PAYPAL_PLAN_ID) return { ok: false, error: "That isn't a CareHouse One subscription." };
  if (!["APPROVED", "ACTIVE"].includes(p.status)) return { ok: false, error: "PayPal hasn't approved this subscription." };
  const v = fromPaypal(p, now);
  const token = randomToken();
  const setup = { setupTokenHash: sha256(token), setupExpiresAt: new Date(now.getTime() + SETUP_DAYS * DAY) };
  const [existing] = await db.select().from(subscriptions).where(eq(subscriptions.paypalSubscriptionId, p.id));
  if (existing?.orgId) return { ok: false, error: "This subscription is already set up. Sign in at the app instead." };
  const values = { planId: p.plan_id, status: v.status, quantity: v.quantity, payerEmail: v.payerEmail, payerName: v.payerName, nextBillingAt: v.nextBillingAt, failedPayments: v.failedPayments, syncedAt: now, ...setup };
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

/** Updates our copy from PayPal, and emails the billing contact the first time a payment fails. */
async function applyPaypal(db: DB, row: Subscription, p: PaypalSubscription, now: Date): Promise<void> {
  const v = fromPaypal(p, now);
  const pastDueSince = v.behind ? (row.pastDueSince ?? now) : null;
  await db
    .update(subscriptions)
    .set({ status: v.status, quantity: v.quantity, nextBillingAt: v.nextBillingAt, failedPayments: v.failedPayments, pastDueSince, syncedAt: now })
    .where(eq(subscriptions.id, row.id));
  if (row.orgId && v.behind && !row.pastDueSince) {
    for (const to of await billingContacts(db, row)) {
      await sendMail(db, {
        orgId: row.orgId,
        to,
        subject: "Your CareHouse One payment didn't go through",
        body: `PayPal couldn't take the latest CareHouse One payment. PayPal will try again; you can update the payment method in your PayPal account under Payments > Automatic payments.\n\nCare records and the medication record keep working. If the payment isn't sorted out within ${READ_ONLY_AFTER_DAYS} days, adding staff, tablets and settings changes are paused until it is.`,
      });
    }
  }
}

async function billingContacts(db: DB, row: Subscription): Promise<string[]> {
  if (!row.orgId) return [];
  const owners = await db.select({ email: users.email }).from(users).where(and(eq(users.orgId, row.orgId), eq(users.role, "owner"), eq(users.status, "active")));
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

/**
 * Housekeeping (from /api/cron): refresh subscriptions every 6 hours in case a webhook was missed,
 * and on the first of the month send PayPal the number of active residents.
 */
export async function syncSubscriptions(db: DB, now = new Date()): Promise<{ refreshed: number; counted: number }> {
  if (!paypalConfigured()) return { refreshed: 0, counted: 0 };
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
  let counted = 0;
  const month = now.toISOString().slice(0, 7);
  if (now.getUTCDate() === 1) {
    const due = await db
      .select()
      .from(subscriptions)
      .where(and(isNotNull(subscriptions.orgId), eq(subscriptions.status, "ACTIVE"), or(isNull(subscriptions.quantitySyncedMonth), lt(subscriptions.quantitySyncedMonth, month))));
    for (const row of due) {
      try {
        const [{ n }] = await db.select({ n: count() }).from(residents).where(and(eq(residents.orgId, row.orgId!), eq(residents.status, "active")));
        const quantity = Math.max(1, n);
        let approvalUrl: string | null = null;
        if (quantity !== row.quantity) approvalUrl = (await reviseQuantity(row.paypalSubscriptionId, quantity)).approvalUrl;
        await db.update(subscriptions).set({ quantitySyncedMonth: month, approvalUrl }).where(eq(subscriptions.id, row.id));
        await audit(db, { orgId: row.orgId!, actorId: null, action: "billing_count_sent", entity: "subscription", entityId: row.id, details: { residents: quantity, needsApproval: !!approvalUrl } });
        counted++;
      } catch (e) {
        console.error(`[billing] resident count failed for ${row.id}: ${(e as Error).message}`);
      }
    }
  }
  return { refreshed, counted };
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
  if (s.pastDueSince) {
    const locked = now.getTime() - s.pastDueSince.getTime() > READ_ONLY_AFTER_DAYS * DAY;
    return {
      managed: false,
      label: "Payment overdue",
      tone: "crit",
      adminLocked: locked,
      warning: locked
        ? "Payment is more than 14 days overdue. Care records keep working; adding staff, tablets and settings changes are paused until PayPal takes the payment."
        : "PayPal couldn't take the latest payment. Update the payment method in PayPal within 14 days to avoid pausing admin features. Care records are never affected.",
    };
  }
  if (s.approvalUrl) return { managed: false, label: "Approval needed", tone: "warn", adminLocked: false, warning: "Approve this month's resident count in PayPal." };
  const trial = now.getTime() - s.createdAt.getTime() < TRIAL_DAYS * DAY;
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
