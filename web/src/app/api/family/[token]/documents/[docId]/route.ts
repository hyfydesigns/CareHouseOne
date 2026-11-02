import { NextResponse } from "next/server";
import { asFamily } from "@/lib/family-session";
import { fileResponse } from "@/lib/file-response";
import { audit } from "@/server/audit";
import { familyDocument } from "@/server/onboarding";

type Ctx = { params: Promise<{ token: string; docId: string }> };

/** A signed copy, for the family after admission. Every download is in the home's audit log. */
export async function GET(request: Request, { params }: Ctx) {
  const { token, docId } = await params;
  const d = await asFamily(token, async (tx, p) => {
    const doc = await familyDocument(tx, p, docId);
    if (doc) await audit(tx, { orgId: p.orgId, actorId: null, action: "document_downloaded_by_family", entity: "resident", entityId: doc.residentId, details: { documentId: doc.id, packetId: p.id } });
    return doc;
  });
  if (!d) return new NextResponse(null, { status: 404 });
  return fileResponse(d, new URL(request.url).searchParams.has("download"));
}
