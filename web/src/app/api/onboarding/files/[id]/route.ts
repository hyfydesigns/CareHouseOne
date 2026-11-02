import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { currentUser } from "@/lib/session";
import { staffFile } from "@/server/onboarding";

type Ctx = { params: Promise<{ id: string }> };

/** A document the family uploaded, for owners and admins to check. */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const f = await withTenant(await getDb(), u.orgId, (tx) => staffFile(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id));
  if (!f) return new NextResponse(null, { status: 404 });
  return fileResponse(f, new URL(request.url).searchParams.has("download"));
}
