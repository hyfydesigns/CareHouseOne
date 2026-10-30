import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { currentUser } from "@/lib/session";
import { getAttachment } from "@/server/attachments";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A progress note attachment, for signed-in staff who can see the resident. Never cached (the
 * tablet is shared); `?download=1` saves it instead of opening it.
 */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const a = await withTenant(await getDb(), u.orgId, (tx) => getAttachment(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id));
  if (!a) return new NextResponse(null, { status: 404 });
  const download = new URL(request.url).searchParams.has("download");
  const name = a.filename.replace(/"/g, "");
  return new NextResponse(new Uint8Array(a.data), {
    headers: {
      "Content-Type": a.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      // A PDF opens in the browser's own viewer; nothing in it may run scripts or reach out.
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
