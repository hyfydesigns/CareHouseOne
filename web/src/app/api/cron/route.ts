import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { cronAuthorized } from "@/lib/cron-auth";
import { remindAppointments } from "@/server/appointments";
import { syncSubscriptions } from "@/server/billing";
import { deliverOutbox } from "@/server/mailer";
import { pruneRateLimits } from "@/server/rate-limit";
import { remindCertifications } from "@/server/training";

/**
 * Housekeeping, called every 5 minutes by Cloud Scheduler with the CRON_SECRET bearer token:
 * retries emails that couldn't be sent, refreshes PayPal subscriptions and runs the billing
 * calendar (invoices on the 29th, due on the 5th, late on the 10th), reminds owners about expiring
 * staff training and the day's appointments, and clears old rate-limit counters.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const db = await getDb();
  const mail = await deliverOutbox(db);
  const billing = await syncSubscriptions(db);
  const training = await remindCertifications(db, new Date());
  const appointments = await remindAppointments(db, new Date());
  await pruneRateLimits(db);
  return NextResponse.json({ mail, billing, training, appointments }, { headers: { "Cache-Control": "no-store" } });
}
