import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { currentUser } from "@/lib/session";
import { audit } from "@/server/audit";
import { getStaffDocument } from "@/server/staff-documents";

type Ctx = { params: Promise<{ id: string }> };

/** A document on a staff member's file, for owners and admins. Every open is in the audit log. */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const download = new URL(request.url).searchParams.has("download");
  const d = await withTenant(await getDb(), u.orgId, async (tx) => {
    const doc = await getStaffDocument(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id);
    if (doc) await audit(tx, { orgId: doc.orgId, actorId: u.id, action: download ? "document_downloaded" : "document_viewed", entity: "user", entityId: doc.userId, details: { documentId: doc.id } });
    return doc;
  });
  if (!d) return new NextResponse(null, { status: 404 });
  return fileResponse(d, download);
}
