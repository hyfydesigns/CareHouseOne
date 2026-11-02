import { NextResponse } from "next/server";
import { asFamily } from "@/lib/family-session";
import { sameOrigin } from "@/lib/same-origin";
import { MAX_ATTACHMENT_BYTES } from "@/server/attachments";
import { familyUpload } from "@/server/onboarding";

type Ctx = { params: Promise<{ token: string; itemId: string }> };

/** The family uploads one photo or PDF for a document request: multipart form with "file". */
export async function POST(request: Request, { params }: Ctx) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  const { token, itemId } = await params;
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Choose a photo or PDF." }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: `${file.name} is too large. Use files under 9 MB.` }, { status: 400 });
  const data = Buffer.from(await file.arrayBuffer());
  const r = await asFamily(token, (tx, p) => familyUpload(tx, p, itemId, { name: file.name || "photo", data }));
  if (!r) return NextResponse.json({ error: "Your session has ended. Reload the page and confirm the code again." }, { status: 401 });
  return r.ok ? NextResponse.json({ message: r.message }) : NextResponse.json({ error: r.error }, { status: 400 });
}
