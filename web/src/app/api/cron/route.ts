import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { syncSubscriptions } from "@/server/billing";
import { deliverOutbox } from "@/server/mailer";
import { pruneRateLimits } from "@/server/rate-limit";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!secret || given.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/**
 * Housekeeping, called every 5 minutes by Cloud Scheduler with the CRON_SECRET bearer token:
 * retries emails that couldn't be sent, refreshes PayPal subscriptions (and sends the resident
 * count on the first of the month), and clears old rate-limit counters.
 */
export async function POST(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const db = await getDb();
  const mail = await deliverOutbox(db);
  const billing = await syncSubscriptions(db);
  await pruneRateLimits(db);
  return NextResponse.json({ mail, billing }, { headers: { "Cache-Control": "no-store" } });
}
