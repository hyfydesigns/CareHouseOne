import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { sameOrigin } from "@/lib/same-origin";
import { currentUser } from "@/lib/session";
import { MAX_ATTACHMENT_BYTES } from "@/server/attachments";
import { paperCopyOf, paperUpload } from "@/server/onboarding";
import { renderPaperFormPdf } from "@/server/onboarding-pdf";

type Ctx = { params: Promise<{ id: string }> };

/** One form of an onboarding, printed to fill in and sign by hand, with the names and answers so far. */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const packetId = new URL(request.url).searchParams.get("packet") ?? "";
  const pdf = await withTenant(await getDb(), u.orgId, async (tx) => {
    const c = await paperCopyOf(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, packetId, id);
    return c && renderPaperFormPdf(c.form, c.head);
  });
  if (!pdf) return new NextResponse(null, { status: 404 });
  return fileResponse({ data: pdf, contentType: "application/pdf", filename: "paper-form.pdf" }, false);
}

/** The signed paper copy, scanned or photographed: multipart form with "file". */
export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { id } = await params;
  const packetId = new URL(request.url).searchParams.get("packet") ?? "";
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo or PDF." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: `${file.name} is too large. Use files under 9 MB.` }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const r = await withTenant(await getDb(), u.orgId, (tx) => paperUpload(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, packetId, id, { name: file.name || "scan", data }));
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}
