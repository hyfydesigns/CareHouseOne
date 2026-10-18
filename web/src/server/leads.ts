import { z } from "zod";
import type { DB } from "@/db/client";
import { leads } from "@/db/schema";
import { sendMail } from "./audit";

const leadSchema = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  organization: z.string().trim().min(2, "Enter your organization's name.").max(160),
  homes: z.coerce.number().int().min(1).max(500).optional().catch(undefined),
  residents: z.coerce.number().int().min(1).max(5000).optional().catch(undefined),
  message: z.string().trim().max(2000).optional(),
});

/**
 * "Request a demo" from the public site. Stored, and emailed to LEADS_EMAIL when set. The form
 * asks people not to include anything about residents.
 */
export async function createLead(db: DB, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = leadSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  await db.insert(leads).values({ name: v.name, email: v.email, organization: v.organization, homes: v.homes ?? null, residents: v.residents ?? null, message: v.message || null });
  const to = process.env.LEADS_EMAIL;
  if (to) {
    await sendMail(db, {
      orgId: null,
      to,
      subject: `Demo request: ${v.organization}`,
      body: `${v.name} <${v.email}>\n${v.organization}\nHomes: ${v.homes ?? "not given"} · Residents: ${v.residents ?? "not given"}\n\n${v.message ?? ""}`,
    });
  }
  return { ok: true };
}
