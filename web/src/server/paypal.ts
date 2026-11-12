/**
 * PayPal REST API, server side only. Settings:
 *   PAYPAL_ENV            "sandbox" (default) or "live"
 *   PAYPAL_CLIENT_ID      public; also used by the PayPal button on the sign-up page
 *   PAYPAL_CLIENT_SECRET  secret (Secret Manager)
 *   PAYPAL_PLAN_ID        the CareHouse One plan, created with scripts/paypal-setup.ts
 *   PAYPAL_WEBHOOK_ID     the webhook registered in the PayPal developer dashboard
 * Only organization names, the billing contact and the amounts are ever sent.
 */

import { INTRO_MONTHS, INTRO_PRICE_PER_HOME, PRICE_PER_HOME, TRIAL_DAYS } from "@/lib/pricing";

export { TRIAL_DAYS };

export const paypalLive = () => process.env.PAYPAL_ENV === "live";
const base = () => (paypalLive() ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com");

export function paypalConfigured(): boolean {
  return !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_PLAN_ID);
}

let cached: { token: string; expires: number } | null = null;

async function accessToken(): Promise<string> {
  if (cached && cached.expires > Date.now() + 60_000) return cached.token;
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal isn't configured");
  const res = await fetch(`${base()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`PayPal sign-in failed (${res.status})`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: j.access_token, expires: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

/** Test helper: forget the cached access token. */
export function resetPaypalToken() {
  cached = null;
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`PayPal ${method} ${path.split("?")[0]} failed (${res.status})`);
  return (res.status === 204 ? {} : await res.json()) as T;
}

export interface PaypalSubscription {
  id: string;
  plan_id: string;
  status: string;
  quantity?: string;
  subscriber?: { email_address?: string; name?: { given_name?: string; surname?: string } };
  start_time?: string;
  create_time?: string;
  status_update_time?: string;
  billing_info?: {
    next_billing_time?: string;
    failed_payments_count?: number;
    last_payment?: { amount?: { value?: string }; time?: string };
    outstanding_balance?: { value?: string };
  };
  /** Only with `withPlan`: the plan as this subscription runs it, overrides included. */
  plan?: { billing_cycles?: Array<{ sequence?: number; total_cycles?: number; pricing_scheme?: { fixed_price?: { value?: string } } }> };
  links?: Array<{ rel: string; href: string }>;
}

export function getSubscription(id: string, withPlan = false): Promise<PaypalSubscription> {
  if (!/^I-[A-Z0-9]{6,32}$/.test(id)) return Promise.reject(new Error("Not a PayPal subscription ID"));
  return call<PaypalSubscription>("GET", `/v1/billing/subscriptions/${id}${withPlan ? "?fields=plan" : ""}`);
}

/**
 * Creates a subscription (awaiting the buyer's approval in the PayPal window) with this
 * subscriber's start date and prorated first cycle. Done here, not by the browser button: PayPal
 * only lets the app's own credentials override the plan's prices. Returns PayPal's subscription ID.
 */
export async function createSubscription(quantity: number, terms: { start_time: string; plan: unknown }): Promise<string> {
  const planId = process.env.PAYPAL_PLAN_ID;
  if (!planId) throw new Error("PayPal isn't configured");
  const r = await call<{ id?: string }>("POST", "/v1/billing/subscriptions", {
    plan_id: planId,
    quantity: String(quantity),
    ...terms,
    application_context: { brand_name: "CareHouse One", shipping_preference: "NO_SHIPPING", user_action: "SUBSCRIBE_NOW" },
  });
  if (!r.id || !/^I-[A-Z0-9]{6,32}$/.test(r.id)) throw new Error("PayPal didn't return a subscription ID");
  return r.id;
}

/**
 * A PayPal invoice that PayPal emails to the payer, for what a subscription can't collect: a late
 * fee (which can't be added to a subscription payment) or, after the subscription is cancelled,
 * the invoices still owed. Due on receipt, or on `dueOn` ("YYYY-MM-DD"). Returns PayPal's invoice ID.
 */
export async function sendPaypalInvoice(i: { email: string; item: string; quantity?: number; unitCents: number; note: string; number?: string; dueOn?: string }): Promise<string> {
  const created = await call<{ id?: string; href?: string; links?: Array<{ rel: string; href: string }> }>("POST", "/v2/invoicing/invoices", {
    detail: {
      currency_code: "USD",
      ...(i.number ? { invoice_number: i.number } : {}),
      note: i.note,
      payment_term: i.dueOn ? { term_type: "DUE_ON_DATE_SPECIFIED", due_date: i.dueOn } : { term_type: "DUE_ON_RECEIPT" },
    },
    primary_recipients: [{ billing_info: { email_address: i.email } }],
    items: [{ name: i.item, quantity: String(i.quantity ?? 1), unit_amount: { currency_code: "USD", value: (i.unitCents / 100).toFixed(2) } }],
  });
  const id = created.id ?? (created.href ?? created.links?.find((l) => l.rel === "self")?.href ?? "").split("/").pop();
  if (!id || !PAYPAL_INVOICE_ID.test(id)) throw new Error("PayPal didn't return an invoice ID");
  await call("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: false });
  return id;
}

export const PAYPAL_INVOICE_ID = /^INV2-[A-Z0-9-]{4,40}$/;

export function sendLateFeeInvoice(email: string, amountCents: number, note: string): Promise<string> {
  return sendPaypalInvoice({ email, item: "CareHouse One late fee", unitCents: amountCents, note });
}

/** Cancels a subscription in PayPal (the admin site's "Cancel billing"). */
export async function cancelSubscription(id: string, reason: string): Promise<void> {
  if (!/^I-[A-Z0-9]{6,32}$/.test(id)) throw new Error("Not a PayPal subscription ID");
  await call("POST", `/v1/billing/subscriptions/${id}/cancel`, { reason });
}

/** Cancels a PayPal invoice that hasn't been paid (a waived late fee), telling the payer. */
export async function cancelPaypalInvoice(id: string, note: string): Promise<void> {
  if (!PAYPAL_INVOICE_ID.test(id)) throw new Error("Not a PayPal invoice ID");
  await call("POST", `/v2/invoicing/invoices/${id}/cancel`, { subject: "Invoice cancelled", note, send_to_recipient: true, send_to_invoicer: false });
}

/** Has PayPal email the payer a reminder for an unpaid invoice. */
export async function remindPaypalInvoice(id: string, note: string): Promise<void> {
  if (!PAYPAL_INVOICE_ID.test(id)) throw new Error("Not a PayPal invoice ID");
  await call("POST", `/v2/invoicing/invoices/${id}/remind`, { subject: "Reminder: CareHouse One invoice", note, send_to_recipient: true, send_to_invoicer: false });
}

/** Whether the payer has paid a PayPal invoice (or it was marked paid in PayPal). */
export async function paypalInvoicePaid(id: string): Promise<boolean> {
  if (!PAYPAL_INVOICE_ID.test(id)) throw new Error("Not a PayPal invoice ID");
  const r = await call<{ status?: string }>("GET", `/v2/invoicing/invoices/${id}`);
  return r.status === "PAID" || r.status === "MARKED_AS_PAID";
}

/**
 * Changes the number of homes billed (the quantity). PayPal may need the payer to approve a higher amount;
 * then it returns an "approve" link for the billing screen.
 */
export async function reviseQuantity(id: string, quantity: number): Promise<{ approvalUrl: string | null }> {
  const r = await call<{ links?: Array<{ rel: string; href: string }> }>("POST", `/v1/billing/subscriptions/${id}/revise`, { quantity: String(quantity) });
  return { approvalUrl: r.links?.find((l) => l.rel === "approve")?.href ?? null };
}

/** Asks PayPal whether a webhook delivery is genuine (signed by PayPal, for our webhook). */
export async function verifyWebhook(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const h = (k: string) => headers.get(k) ?? "";
  if (!h("paypal-transmission-id") || !h("paypal-transmission-sig")) return false;
  const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", {
    auth_algo: h("paypal-auth-algo"),
    cert_url: h("paypal-cert-url"),
    transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"),
    transmission_time: h("paypal-transmission-time"),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return r.verification_status === "SUCCESS";
}

/**
 * One-time setup (scripts/paypal-setup.ts): the product and the monthly plan. The quantity is the
 * number of homes. There's no free cycle: each subscription starts charging on its first payment
 * day (a 5th), and the free trial is the time before that. Each subscription overrides the first
 * cycle with its prorated price (paypalTerms in lib/billing-cycle.ts); then come the introductory
 * months and the regular price.
 */
export async function createProductAndPlan(): Promise<{ productId: string; planId: string }> {
  const product = await call<{ id: string }>("POST", "/v1/catalogs/products", {
    name: "CareHouse One",
    description: "Care records for group homes",
    type: "SERVICE",
    category: "SOFTWARE",
  });
  const plan = await call<{ id: string }>("POST", "/v1/billing/plans", {
    product_id: product.id,
    name: "CareHouse One",
    description: `${TRIAL_DAYS}-day free trial, then $${INTRO_PRICE_PER_HOME} per home per month for ${INTRO_MONTHS} months, then $${PRICE_PER_HOME} per home per month. Charged on the 5th.`,
    status: "ACTIVE",
    quantity_supported: true,
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "TRIAL",
        sequence: 1,
        total_cycles: 1,
        pricing_scheme: { fixed_price: { value: String(INTRO_PRICE_PER_HOME), currency_code: "USD" } },
      },
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "TRIAL",
        sequence: 2,
        total_cycles: INTRO_MONTHS,
        pricing_scheme: { fixed_price: { value: String(INTRO_PRICE_PER_HOME), currency_code: "USD" } },
      },
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 3,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: String(PRICE_PER_HOME), currency_code: "USD" } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  });
  return { productId: product.id, planId: plan.id };
}
