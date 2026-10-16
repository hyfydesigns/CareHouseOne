import { NextResponse } from "next/server";
import { getDb } from "@/db/client";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { syncEntries } from "@/server/sync";

/** Uploads vital signs and progress notes that a tablet saved while it was offline. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const me = await currentUser();
  if (!me) return NextResponse.json({ error: "Sign in to send saved entries." }, { status: 401 });
  if (me.locked || me.needsPin) return NextResponse.json({ error: "Unlock the tablet to send saved entries." }, { status: 423 });
  const body = await request.json().catch(() => null);
  const results = await syncEntries(await getDb(), me, body?.items, new Date());
  return NextResponse.json({ results }, { headers: { "Cache-Control": "no-store" } });
}
