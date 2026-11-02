import { NextResponse } from "next/server";
import { asFamily } from "@/lib/family-session";
import { fileResponse } from "@/lib/file-response";
import { familyFile } from "@/server/onboarding";

type Ctx = { params: Promise<{ token: string; fileId: string }> };

/** A file the family uploaded, for the family to check. */
export async function GET(request: Request, { params }: Ctx) {
  const { token, fileId } = await params;
  const f = await asFamily(token, (tx, p) => familyFile(tx, p, fileId));
  if (!f) return new NextResponse(null, { status: 404 });
  return fileResponse(f, new URL(request.url).searchParams.has("download"));
}
