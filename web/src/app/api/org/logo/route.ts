import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { MAX_LOGO_BYTES, removeLogo, setLogo } from "@/server/org";

async function me(request: Request) {
  if (!sameOrigin(request)) return null;
  const u = await currentUser();
  return u && !u.locked && !u.needsPin ? u : null;
}

/** Upload the organization's logo: multipart form with "logo". Owners and admins. */
export async function POST(request: Request) {
  const u = await me(request);
  if (!u) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const form = await request.formData().catch(() => null);
  const file = form?.get("logo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose an image." }, { status: 400 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: "That image is too large. Use one under 5 MB." }, { status: 400 });
  const r = await withTenant(await getDb(), u.orgId, async (tx) => setLogo(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, u.orgId, Buffer.from(await file.arrayBuffer())));
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function DELETE(request: Request) {
  const u = await me(request);
  if (!u) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const r = await withTenant(await getDb(), u.orgId, (tx) => removeLogo(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, u.orgId));
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}
