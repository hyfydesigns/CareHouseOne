import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { getResidentPhoto, MAX_UPLOAD_BYTES, removeResidentPhoto, setResidentPhoto } from "@/server/photos";

type Ctx = { params: Promise<{ id: string }> };

/** Signed-in, unlocked staff of the resident's organization only. */
async function me() {
  const u = await currentUser();
  return u && !u.locked && !u.needsPin ? u : null;
}
const actorOf = (u: NonNullable<Awaited<ReturnType<typeof me>>>) => ({ id: u.id, role: u.role, facilityIds: u.facilityIds });

/** The photo. Never cached: it identifies a resident, and the tablet is shared. */
export async function GET(_: Request, { params }: Ctx) {
  const u = await me();
  if (!u) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const photo = await withTenant(await getDb(), u.orgId, (tx) => getResidentPhoto(tx, actorOf(u), id));
  if (!photo) return new NextResponse(null, { status: 404 });
  return new NextResponse(new Uint8Array(photo.data), { headers: { "Content-Type": photo.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

/** Add or replace (owners and admins): multipart form with a "photo" file. */
export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = await me();
  if (!u) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("photo");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo." }, { status: 400 });
  if (file.size > MAX_UPLOAD_BYTES) return NextResponse.json({ error: "That photo is too large. Use one under 8 MB." }, { status: 400 });
  const r = await withTenant(await getDb(), u.orgId, async (tx) => setResidentPhoto(tx, actorOf(u), id, Buffer.from(await file.arrayBuffer())));
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}

export async function DELETE(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = await me();
  if (!u) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  const r = await withTenant(await getDb(), u.orgId, (tx) => removeResidentPhoto(tx, actorOf(u), id));
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}
