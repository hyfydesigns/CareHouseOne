import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { addAttachment, MAX_ATTACHMENT_BYTES } from "@/server/attachments";

type Ctx = { params: Promise<{ id: string }> };

/** Attach one photo or PDF to a progress note: multipart form with a "file". One file per request. */
export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo or file." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: `${file.name} is too large. Use files under 9 MB.` }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const r = await withTenant(await getDb(), u.orgId, (tx) => addAttachment(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id, { name: file.name || "photo", data }));
  return r.ok ? NextResponse.json({ message: r.message, id: r.data?.id }) : NextResponse.json({ error: r.error }, { status: 400 });
}
