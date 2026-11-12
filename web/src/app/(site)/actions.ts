"use server";

import type { FormState } from "@/components/status";
import { getDb } from "@/db/client";
import { appBaseUrl } from "@/lib/hosts";
import { clientIp } from "@/lib/session";
import { registerSubscription, startSubscription } from "@/server/billing";
import { createLead } from "@/server/leads";
import { deliverNow } from "@/server/mailer";
import { hit, tooMany } from "@/server/rate-limit";

export async function demoAction(_: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limit = await hit(db, "lead", await clientIp());
  if (!limit.ok) return { error: tooMany(limit) };
  // Bots fill in every field; people never see this one.
  if (fd.get("website")) return { message: "We'll email you within one business day to find a time." };
  const r = await createLead(db, Object.fromEntries(["name", "email", "organization", "homes", "residents", "message"].map((k) => [k, fd.get(k) ?? undefined])));
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  return { message: "We'll email you within one business day to find a time." };
}

/**
 * Called by the PayPal button: the server creates the subscription with when PayPal starts charging
 * (the first 5th after the first cycle) and the prorated first cycle, and the button opens PayPal's
 * window to approve it. The server checks the terms again when the buyer comes back.
 */
export async function startSubscriptionAction(homes: number): Promise<{ id?: string; error?: string }> {
  const limit = await hit(await getDb(), "subscribe", await clientIp());
  if (!limit.ok) return { error: tooMany(limit) };
  const r = await startSubscription(homes);
  return r.ok ? { id: r.id } : { error: r.error };
}

/** Called by the PayPal button once the buyer approves the subscription. Returns where to go next. */
export async function subscribedAction(subscriptionId: string): Promise<{ setupUrl?: string; error?: string }> {
  const db = await getDb();
  const limit = await hit(db, "link", await clientIp());
  if (!limit.ok) return { error: tooMany(limit) };
  const r = await registerSubscription(db, String(subscriptionId), appBaseUrl());
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  return { setupUrl: r.setupUrl };
}
