import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { handleWebhook } from "@/server/billing";
import { verifyWebhook } from "@/server/paypal";

/**
 * PayPal subscription and payment events. Each delivery is checked with PayPal's
 * verify-webhook-signature API before anything is read from it; the subscription itself is then
 * fetched from PayPal rather than trusted from the event body.
 */
export async function POST(request: Request) {
  const raw = await request.text();
  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  let genuine = false;
  try {
    genuine = await verifyWebhook(request.headers, event);
  } catch (e) {
    console.error(`[billing] webhook verification unavailable: ${(e as Error).message}`);
    return NextResponse.json({ error: "Try again" }, { status: 503 });
  }
  if (!genuine) return NextResponse.json({ error: "Not verified" }, { status: 400 });
  const outcome = await handleWebhook(await getDb(), event as Parameters<typeof handleWebhook>[1]);
  return NextResponse.json({ outcome });
}
