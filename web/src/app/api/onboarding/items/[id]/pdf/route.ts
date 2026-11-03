import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { currentUser } from "@/lib/session";
import { getOnboarding, signatureEvidence } from "@/server/onboarding";
import { renderOnboardingPdf } from "@/server/onboarding-pdf";

type Ctx = { params: Promise<{ id: string }> };

/** A preview of the signed PDF for one form, before admission, for owners and admins. */
export async function GET(request: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const packetId = new URL(request.url).searchParams.get("packet") ?? "";
  const pdf = await withTenant(await getDb(), u.orgId, async (tx) => {
    const o = await getOnboarding(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, packetId);
    const item = o?.items.find((i) => i.id === id && i.kind === "form");
    if (!o || !item) return null;
    return renderOnboardingPdf(o.p, item, o.head, await signatureEvidence(tx, item.id));
  });
  if (!pdf) return new NextResponse(null, { status: 404 });
  return fileResponse({ data: pdf, contentType: "application/pdf", filename: "preview.pdf" }, false);
}
