import { getDb } from "@/db/client";
import { contractByToken, renderContractPdf } from "@/server/contracts";

/** The client's copy of their agreement, from the emailed link (signed or not yet). */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const c = await contractByToken(await getDb(), token);
  if (!c) return new Response("This link has expired.", { status: 404 });
  const pdf = await renderContractPdf(c);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="carehouse-one-agreement${c.status === "signed" ? "-signed" : ""}.pdf"`,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
