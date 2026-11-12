import { eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { contracts } from "@/db/schema";
import { currentAdmin } from "@/lib/admin-session";
import { adminLog } from "@/server/admin-auth";
import { renderContractPdf } from "@/server/contracts";

/** A contract as a PDF, for the admin site (signed or not). */
export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const admin = await currentAdmin();
  if (!admin) return new Response("Not found", { status: 404 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return new Response("Not found", { status: 404 });
  const db = await getDb();
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c) return new Response("Not found", { status: 404 });
  await adminLog(db, { adminId: admin.id, orgId: c.orgId, action: "contract_downloaded", entity: "contract", entityId: c.id });
  const pdf = await renderContractPdf(c);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="carehouse-one-agreement-${c.status}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
