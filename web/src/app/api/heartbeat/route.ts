import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";

/** The tablet reports that someone is still using it, so the server-side lock doesn't fire mid-form. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const me = await currentUser();
  return NextResponse.json({ signedIn: !!me, locked: !!me?.locked }, { headers: { "Cache-Control": "no-store" } });
}
