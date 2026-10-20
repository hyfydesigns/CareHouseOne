/**
 * PayPal REST API, server side only. Settings:
 *   PAYPAL_ENV            "sandbox" (default) or "live"
 *   PAYPAL_CLIENT_ID      public; also used by the PayPal button on the sign-up page
 *   PAYPAL_CLIENT_SECRET  secret (Secret Manager)
 *   PAYPAL_PLAN_ID        the CareHouse One plan, created with scripts/paypal-setup.ts
 *   PAYPAL_WEBHOOK_ID     the webhook registered in the PayPal developer dashboard
 * Only organization names, the billing contact and the monthly amount are ever sent.
 */

import { INCLUDED_RESIDENTS, PRICE_PER_EXTRA_RESIDENT, PRICE_PER_HOME } from "@/lib/pricing";

export const TRIAL_DAYS = 30;

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
  billing_info?: { next_billing_time?: string; failed_payments_count?: number };
  links?: Array<{ rel: string; href: string }>;
}

export function getSubscription(id: string): Promise<PaypalSubscription> {
  if (!/^I-[A-Z0-9]{6,32}$/.test(id)) return Promise.reject(new Error("Not a PayPal subscription ID"));
  return call<PaypalSubscription>("GET", `/v1/billing/subscriptions/${id}`);
}

/**
 * Changes the monthly amount (the quantity of $1 units). PayPal may need the payer to approve a higher amount;
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
 * One-time setup (scripts/paypal-setup.ts): the product and the monthly plan with a free trial.
 * The plan's unit is $1 and the quantity is the monthly total, because PayPal can only multiply
 * one price by a quantity and the bill is per home plus extra residents.
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
    description: `$${PRICE_PER_HOME} per home per month (up to ${INCLUDED_RESIDENTS} residents), $${PRICE_PER_EXTRA_RESIDENT} per extra resident; ${TRIAL_DAYS}-day free trial`,
    status: "ACTIVE",
    quantity_supported: true,
    billing_cycles: [
      { frequency: { interval_unit: "DAY", interval_count: TRIAL_DAYS }, tenure_type: "TRIAL", sequence: 1, total_cycles: 1 },
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 2,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: "1", currency_code: "USD" } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 3 },
  });
  return { productId: product.id, planId: plan.id };
}
