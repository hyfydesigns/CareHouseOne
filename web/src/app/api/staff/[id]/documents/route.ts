import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { MAX_ATTACHMENT_BYTES } from "@/server/attachments";
import { addStaffDocument } from "@/server/staff-documents";

type Ctx = { params: Promise<{ id: string }> };

/** Add one document to a staff member's file: multipart form with "file", "title" and "category". */
export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo or PDF." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: `${file.name} is too large. Use files under 9 MB.` }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const r = await withTenant(await getDb(), u.orgId, (tx) =>
    addStaffDocument(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id, { name: file.name || "document", data, title: form?.get("title"), category: form?.get("category") }),
  );
  return r.ok ? NextResponse.json({ message: r.message, id: r.data?.id }) : NextResponse.json({ error: r.error }, { status: 400 });
}
