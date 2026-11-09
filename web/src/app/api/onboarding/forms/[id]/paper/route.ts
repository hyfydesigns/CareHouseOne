import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { currentUser } from "@/lib/session";
import { blankFormOf } from "@/server/onboarding";
import { renderPaperFormPdf } from "@/server/onboarding-pdf";

type Ctx = { params: Promise<{ id: string }> };

/** A form from the list, blank, to print for someone who can't fill it in online. Owners and admins. */
export async function GET(_: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  const pdf = await withTenant(await getDb(), u.orgId, async (tx) => {
    const c = await blankFormOf(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id);
    return c && renderPaperFormPdf(c.form, c.head);
  });
  if (!pdf) return new NextResponse(null, { status: 404 });
  return fileResponse({ data: pdf, contentType: "application/pdf", filename: "blank-form.pdf" }, false);
}
