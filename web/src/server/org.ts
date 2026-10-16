import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { organizations } from "@/db/schema";
import { canViewAudit, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import type { Result } from "./residents";

export async function getOrg(tx: Tx, orgId: string) {
  const [org] = await tx.select().from(organizations).where(eq(organizations.id, orgId));
  return org ?? null;
}

const residentCheckSchema = z.enum(["two_identifiers", "wristband"]);

/** Owners and admins choose how caregivers confirm the right person before medications. */
export async function setResidentCheck(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result> {
  if (!canViewAudit(actor)) return { ok: false, error: "Only owners and admins can change organization settings." };
  const p = residentCheckSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose one of the options." };
  const org = await getOrg(tx, orgId);
  if (!org) return { ok: false, error: "Organization not found." };
  if (org.residentCheck === p.data) return { ok: true, message: "No change." };
  await tx.update(organizations).set({ residentCheck: p.data }).where(eq(organizations.id, orgId));
  await audit(tx, { orgId, actorId: actor.id, action: "setting_changed", entity: "organization", entityId: orgId, details: { setting: "resident_check", from: org.residentCheck, to: p.data } });
  return {
    ok: true,
    message: p.data === "wristband" ? "Saved. Caregivers now scan a wristband before every medication." : "Saved. Caregivers now confirm name and date of birth before every medication.",
  };
}
