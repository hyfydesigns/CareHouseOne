import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { currentUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { getDocument } from "@/server/documents";

type Ctx = { params: Promise<{ id: string }> };

/**
 * A document on a resident's file, for owners and admins. Never cached; every open is in the
 * audit log. `?download=1` saves it instead of opening it.
 */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const download = new URL(request.url).searchParams.has("download");
  const d = await withTenant(await getDb(), u.orgId, async (tx) => {
    const doc = await getDocument(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id);
    if (doc) await audit(tx, { orgId: doc.orgId, actorId: u.id, action: download ? "document_downloaded" : "document_viewed", entity: "resident", entityId: doc.residentId, details: { documentId: doc.id } });
    return doc;
  });
  if (!d) return new NextResponse(null, { status: 404 });
  const name = d.filename.replace(/"/g, "");
  return new NextResponse(new Uint8Array(d.data), {
    headers: {
      "Content-Type": d.contentType,
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${name}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
