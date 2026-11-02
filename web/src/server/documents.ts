import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { residentDocuments, users } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { MAX_ATTACHMENT_BYTES, normaliseAttachment } from "./attachments";
import { audit } from "./audit";
import { getResident, type Result } from "./residents";

export const MAX_DOCUMENT_BYTES = MAX_ATTACHMENT_BYTES;

export const DOC_CATEGORIES = {
  admission: "Admission and agreements",
  consent: "Consents and authorizations",
  legal: "Guardianship and power of attorney",
  id_insurance: "ID and insurance",
  medical: "Medical records and orders",
  care_plan: "Care and support plans",
  other: "Other",
} as const;
export type DocCategory = keyof typeof DOC_CATEGORIES;

const docSchema = z.object({
  title: z.string().trim().min(2, "Give the document a name, for example: Admission agreement.").max(120),
  category: z.enum(Object.keys(DOC_CATEGORIES) as [DocCategory, ...DocCategory[]], { message: "Choose what kind of document it is." }),
});

/** Owners and admins keep a resident's documents; caregivers don't see them. */
export const canManageDocuments = (actor: Pick<Actor, "role">) => canManageCare(actor as Actor);

/** Adds a photo or PDF to a resident's file. */
export async function addDocument(
  tx: Tx,
  actor: Actor,
  residentId: string,
  upload: { name: string; data: Buffer; title: unknown; category: unknown },
  opts: { source?: "upload" | "onboarding"; now?: Date } = {},
): Promise<Result<{ id: string }>> {
  if (!canManageDocuments(actor)) return { ok: false, error: "Only owners and admins can add documents." };
  const r = await getResident(tx, actor, residentId);
  if (!r) return { ok: false, error: "That resident isn't available." };
  const p = docSchema.safeParse({ title: upload.title, category: upload.category });
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (upload.data.length > MAX_DOCUMENT_BYTES) return { ok: false, error: `${upload.name} is too large. Use files under 9 MB, or scan fewer pages at a time.` };
  const file = await normaliseAttachment(upload.data, upload.name);
  if ("error" in file) return { ok: false, error: file.error };
  const [row] = await tx
    .insert(residentDocuments)
    .values({ orgId: r.orgId, residentId: r.id, category: p.data.category, title: p.data.title, filename: file.filename, contentType: file.contentType, sizeBytes: file.data.length, data: file.data, source: opts.source ?? "upload", uploadedBy: actor.id, uploadedAt: opts.now ?? new Date() })
    .returning({ id: residentDocuments.id });
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "document_added", entity: "resident", entityId: r.id, details: { documentId: row.id, title: p.data.title, category: p.data.category } });
  return { ok: true, message: `${p.data.title} added.`, data: { id: row.id } };
}

/** A resident's documents (not the files), newest first within each category. */
export async function listDocuments(tx: Tx, actor: Actor, residentId: string) {
  if (!canManageDocuments(actor)) return [];
  const r = await getResident(tx, actor, residentId);
  if (!r) return [];
  return tx
    .select({
      id: residentDocuments.id,
      category: residentDocuments.category,
      title: residentDocuments.title,
      filename: residentDocuments.filename,
      contentType: residentDocuments.contentType,
      sizeBytes: residentDocuments.sizeBytes,
      source: residentDocuments.source,
      uploadedAt: residentDocuments.uploadedAt,
      by: users.name,
    })
    .from(residentDocuments)
    .leftJoin(users, eq(users.id, residentDocuments.uploadedBy))
    .where(and(eq(residentDocuments.residentId, r.id), isNull(residentDocuments.removedAt)))
    .orderBy(asc(residentDocuments.category), desc(residentDocuments.uploadedAt));
}

/** One document with its file, for owners and admins who can see the resident. */
export async function getDocument(tx: Tx, actor: Actor, id: string) {
  if (!canManageDocuments(actor) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [d] = await tx.select().from(residentDocuments).where(eq(residentDocuments.id, id));
  if (!d || d.removedAt || !(await getResident(tx, actor, d.residentId))) return null;
  return d;
}

/** Takes a document off the file (it stays in the database, with who, when and why). */
export async function removeDocument(tx: Tx, actor: Actor, id: string, raw: unknown, now = new Date()): Promise<Result> {
  const d = await getDocument(tx, actor, id);
  if (!d) return { ok: false, error: "That document isn't available." };
  const p = z.string().trim().min(3, "Say why, for example: wrong resident, or uploaded twice.").max(300).safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await tx.update(residentDocuments).set({ removedAt: now, removedBy: actor.id, removedReason: p.data }).where(eq(residentDocuments.id, d.id));
  await audit(tx, { orgId: d.orgId, actorId: actor.id, action: "document_removed", entity: "resident", entityId: d.residentId, details: { documentId: d.id, title: d.title, reason: p.data } });
  return { ok: true, message: `${d.title} removed from the file.` };
}
