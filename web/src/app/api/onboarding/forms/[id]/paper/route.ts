import { NextResponse } from "next/server";
import { getDb, withTenant } from "@/db/client";
import { fileResponse } from "@/lib/file-response";
import { currentUser } from "@/lib/session";
import { blankFormOf } from "@/server/onboarding";
import { renderPaperFormPdf } from "@/server/onboarding-pdf";

type Ctx = { params: Promise<{ id: string }> };

/** A form from the list, blank, to print for someone who can't fill it in online. Owners and admins. */
export async function GET(req: Request, { params }: Ctx) {
  const u = await currentUser();
  if (!u || u.locked || u.needsPin) return new NextResponse(null, { status: 401 });
  const { id } = await params;
  // ?home=<id> puts that home's details on the form; ?home=none leaves them off.
  const h = new URL(req.url).searchParams.get("home");
  const homeId = h === null ? undefined : h === "none" ? null : h;
  if (homeId && !/^[0-9a-f-]{36}$/i.test(homeId)) return new NextResponse(null, { status: 404 });
  const pdf = await withTenant(await getDb(), u.orgId, async (tx) => {
    const c = await blankFormOf(tx, { id: u.id, role: u.role, facilityIds: u.facilityIds }, id, homeId);
    return c && renderPaperFormPdf(c.form, c.head);
  });
  if (!pdf) return new NextResponse(null, { status: 404 });
  return fileResponse({ data: pdf, contentType: "application/pdf", filename: "blank-form.pdf" }, false);
}
