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
 * A late fee can't be added to a subscription payment, so it goes out as a separate PayPal
 * invoice that PayPal emails to the payer. Returns PayPal's invoice ID.
 */
export async function sendLateFeeInvoice(email: string, amountCents: number, note: string): Promise<string> {
  const created = await call<{ id?: string; href?: string; links?: Array<{ rel: string; href: string }> }>("POST", "/v2/invoicing/invoices", {
    detail: { currency_code: "USD", note, payment_term: { term_type: "DUE_ON_RECEIPT" } },
    primary_recipients: [{ billing_info: { email_address: email } }],
    items: [{ name: "CareHouse One late fee", quantity: "1", unit_amount: { currency_code: "USD", value: (amountCents / 100).toFixed(2) } }],
  });
  const id = created.id ?? (created.href ?? created.links?.find((l) => l.rel === "self")?.href ?? "").split("/").pop();
  if (!id || !/^INV2-[A-Z0-9-]{4,40}$/.test(id)) throw new Error("PayPal didn't return an invoice ID");
  await call("POST", `/v2/invoicing/invoices/${id}/send`, { send_to_recipient: true, send_to_invoicer: false });
  return id;
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
