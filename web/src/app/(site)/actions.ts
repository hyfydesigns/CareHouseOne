"use server";

import type { FormState } from "@/components/status";
import { getDb } from "@/db/client";
import { appBaseUrl } from "@/lib/hosts";
import { clientIp } from "@/lib/session";
import { registerSubscription } from "@/server/billing";
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
