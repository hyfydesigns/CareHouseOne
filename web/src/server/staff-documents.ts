import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { staffDocuments, userFacilities, users } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { MAX_ATTACHMENT_BYTES, normaliseAttachment } from "./attachments";
import { audit } from "./audit";
import type { Result } from "./residents";

export const STAFF_DOC_CATEGORIES = {
  hiring: "Application and hiring",
  agreements: "Agreements and acknowledgements",
  training: "Training and certificates",
  clearance: "Background and health clearances",
  id: "ID and work eligibility",
  other: "Other",
} as const;
export type StaffDocCategory = keyof typeof STAFF_DOC_CATEGORIES;

/** Where a form from onboarding goes on the file, from its title. */
export function staffDocCategoryFor(title: string): StaffDocCategory {
  if (/fingerprint|\btb\b|background|clearance/i.test(title)) return "clearance";
  if (/training|certificate|cpr|first aid|orientation|skills/i.test(title)) return "training";
  if (/agreement|release|disclosure|job description|hipaa/i.test(title)) return "agreements";
  if (/application|reference|interview|hiring/i.test(title)) return "hiring";
  return "other";
}

const docSchema = z.object({
  title: z.string().trim().min(2, "Give the document a name, for example: CPR card.").max(120),
  category: z.enum(Object.keys(STAFF_DOC_CATEGORIES) as [StaffDocCategory, ...StaffDocCategory[]], { message: "Choose what kind of document it is." }),
});

/** A staff member the actor can keep documents for: owners, and admins who share a home with them. */
export async function staffMember(tx: Tx, actor: Actor, userId: string) {
  if (!canManageCare(actor) || !/^[0-9a-f-]{36}$/i.test(userId)) return null;
  const [u] = await tx.select({ id: users.id, orgId: users.orgId, name: users.name, email: users.email }).from(users).where(eq(users.id, userId));
  if (!u) return null;
  if (actor.role === "owner") return u;
  const homes = await tx.select({ id: userFacilities.facilityId }).from(userFacilities).where(eq(userFacilities.userId, u.id));
  return homes.some((h) => actor.facilityIds.includes(h.id)) ? u : null;
}

/** Adds a photo or PDF to a staff member's file. */
export async function addStaffDocument(tx: Tx, actor: Actor, userId: string, upload: { name: string; data: Buffer; title: unknown; category: unknown }, now = new Date()): Promise<Result<{ id: string }>> {
  const u = await staffMember(tx, actor, userId);
  if (!u) return { ok: false, error: "That person isn't available." };
  const p = docSchema.safeParse({ title: upload.title, category: upload.category });
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (upload.data.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${upload.name} is too large. Use files under 9 MB, or scan fewer pages at a time.` };
  const file = await normaliseAttachment(upload.data, upload.name);
  if ("error" in file) return { ok: false, error: file.error };
  const [row] = await tx
    .insert(staffDocuments)
    .values({ orgId: u.orgId, userId: u.id, category: p.data.category, title: p.data.title, filename: file.filename, contentType: file.contentType, sizeBytes: file.data.length, data: file.data, uploadedBy: actor.id, uploadedAt: now })
    .returning({ id: staffDocuments.id });
  await audit(tx, { orgId: u.orgId, actorId: actor.id, action: "document_added", entity: "user", entityId: u.id, details: { documentId: row.id, title: p.data.title, category: p.data.category } });
  return { ok: true, message: `${p.data.title} added.`, data: { id: row.id } };
}

/** A staff member's documents (not the files), newest first within each category. */
export async function listStaffDocuments(tx: Tx, actor: Actor, userId: string) {
  const u = await staffMember(tx, actor, userId);
  if (!u) return [];
  return tx
    .select({
      id: staffDocuments.id,
      category: staffDocuments.category,
      title: staffDocuments.title,
      contentType: staffDocuments.contentType,
      sizeBytes: staffDocuments.sizeBytes,
      source: staffDocuments.source,
      uploadedAt: staffDocuments.uploadedAt,
      by: users.name,
    })
    .from(staffDocuments)
    .leftJoin(users, eq(users.id, staffDocuments.uploadedBy))
    .where(and(eq(staffDocuments.userId, u.id), isNull(staffDocuments.removedAt)))
    .orderBy(asc(staffDocuments.category), desc(staffDocuments.uploadedAt));
}

/** One document with its file, for owners and admins who can see the person. */
export async function getStaffDocument(tx: Tx, actor: Actor, id: string) {
  if (!canManageCare(actor) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await tx.select().from(staffDocuments).where(eq(staffDocuments.id, id));
  if (!d || d.removedAt || !(await staffMember(tx, actor, d.userId))) return null;
  return d;
}

/** Takes a document off the file (it stays in the database, with who, when and why). */
export async function removeStaffDocument(tx: Tx, actor: Actor, id: string, raw: unknown, now = new Date()): Promise<Result> {
  const d = await getStaffDocument(tx, actor, id);
  if (!d) return { ok: false, error: "That document isn't available." };
  const p = z.string().trim().min(3, "Say why, for example: wrong person, or uploaded twice.").max(300).safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await tx.update(staffDocuments).set({ removedAt: now, removedBy: actor.id, removedReason: p.data }).where(eq(staffDocuments.id, d.id));
  await audit(tx, { orgId: d.orgId, actorId: actor.id, action: "document_removed", entity: "user", entityId: d.userId, details: { documentId: d.id, title: d.title, reason: p.data } });
  return { ok: true, message: `${d.title} removed from the file.` };
}
