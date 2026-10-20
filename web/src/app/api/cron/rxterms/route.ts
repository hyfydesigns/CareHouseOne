import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { cronAuthorized } from "@/lib/cron-auth";
import { deliverNow } from "@/server/mailer";
import { refreshRxTerms } from "@/server/rxterms-refresh";

// Downloading and loading RxTerms takes up to a minute or two.
export const maxDuration = 300;

/** Quarterly medication-list update, called by Cloud Scheduler with the CRON_SECRET bearer token. */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  const db = await getDb();
  const result = await refreshRxTerms(db);
  if (result.status === "failed") await deliverNow(db);
  return NextResponse.json(result, { status: result.status === "failed" ? 500 : 200, headers: { "Cache-Control": "no-store" } });
}
