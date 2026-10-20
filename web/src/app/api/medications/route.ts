import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { canManageCare } from "@/lib/permissions";
import { currentUser } from "@/lib/session";
import { searchMedications } from "@/server/medication-catalog";

/** Typeahead for the medication name when entering an order (owners and admins). */
export async function GET(request: Request) {
  const me = await currentUser();
  if (!me || me.locked || me.needsPin || !canManageCare(me)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const q = (new URL(request.url).searchParams.get("q") ?? "").slice(0, 60);
  const result = await withTenant(await getDb(), me.orgId, (tx) => searchMedications(tx, q));
  return NextResponse.json(result, { headers: { "Cache-Control": "private, no-store" } });
}
