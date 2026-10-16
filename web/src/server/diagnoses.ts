import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { icd10Codes, residentDiagnoses, users } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import { getResident, type Result } from "./residents";

/** The newest code-set version loaded ("FY 2027"). Codes not in it need updating. */
export async function currentCodeSet(tx: Tx): Promise<string | null> {
  const [row] = await tx.select({ v: sql<string>`max(${icd10Codes.version})` }).from(icd10Codes);
  return row?.v ?? null;
}

/** Search by code prefix or words in the description. Category codes are returned, marked. */
export async function searchIcd(tx: Tx, q: string, limit = 12) {
  // Escape LIKE wildcards so "%" or "_" in the search box match literally.
  const term = q.trim().replace(/[\\%_]/g, (c) => "\\" + c);
  if (term.length < 2) return [];
  const code = term.toUpperCase().replace(/\s/g, "");
  return tx
    .select()
    .from(icd10Codes)
    .where(or(ilike(icd10Codes.code, `${code}%`), ilike(icd10Codes.description, `%${term}%`)))
    .orderBy(asc(icd10Codes.code))
    .limit(limit);
}

/** The billable codes under a category, for "choose a more specific code". */
export async function childCodes(tx: Tx, category: string) {
  return tx
    .select()
    .from(icd10Codes)
    .where(and(ilike(icd10Codes.code, `${category}%`), eq(icd10Codes.billable, true)))
    .orderBy(asc(icd10Codes.code))
    .limit(30);
}

export async function listDiagnoses(tx: Tx, residentId: string) {
  const current = await currentCodeSet(tx);
  const rows = await tx
    .select({ d: residentDiagnoses, addedBy: users.name, ref: icd10Codes })
    .from(residentDiagnoses)
    .leftJoin(users, eq(users.id, residentDiagnoses.addedBy))
    .leftJoin(icd10Codes, eq(icd10Codes.code, residentDiagnoses.code))
    .where(eq(residentDiagnoses.residentId, residentId))
    .orderBy(asc(residentDiagnoses.code), desc(residentDiagnoses.addedAt));
  return rows.map((r) => ({
    ...r.d,
    addedByName: r.addedBy,
    // Needs a new code if it's gone from (or no longer billable in) the current code set.
    needsUpdate: !r.d.removedAt && !!current && (!r.ref || !r.ref.billable || r.ref.version !== current),
  }));
}

const addSchema = z.object({
  residentId: z.string().uuid(),
  code: z.string().trim().toUpperCase().min(3).max(8),
  label: z.string().trim().max(120).optional(),
});

export async function addDiagnosis(tx: Tx, actor: Actor, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only nurses and managers can change diagnoses." };
  const p = addSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose a code from the list." };
  const r = await getResident(tx, actor, p.data.residentId);
  if (!r) return { ok: false, error: "That resident isn't available." };
  const [ref] = await tx.select().from(icd10Codes).where(eq(icd10Codes.code, p.data.code));
  if (!ref) return { ok: false, error: "That code isn't in the ICD-10-CM code set. Choose one from the list." };
  if (!ref.billable) return { ok: false, error: `${ref.code} is a category, not a billable code. Choose a more specific code.` };
  const current = await currentCodeSet(tx);
  if (current && ref.version !== current) return { ok: false, error: `${ref.code} isn't in the current code set (${current}). Choose its replacement.` };
  const [dup] = await tx.select().from(residentDiagnoses).where(and(eq(residentDiagnoses.residentId, r.id), eq(residentDiagnoses.code, ref.code), isNull(residentDiagnoses.removedAt)));
  if (dup) return { ok: false, error: `${ref.code} is already on ${r.firstName}'s list.` };
  const label = p.data.label || ref.description;
  await tx.insert(residentDiagnoses).values({ orgId: r.orgId, residentId: r.id, code: ref.code, officialDescription: ref.description, label, codeSetVersion: ref.version, addedBy: actor.id });
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "diagnosis_added", entity: "resident", entityId: r.id, details: { code: ref.code, version: ref.version } });
  return { ok: true, message: `${ref.code} added for ${r.firstName}.` };
}

export async function removeDiagnosis(tx: Tx, actor: Actor, diagnosisId: string, reason: string): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only nurses and managers can change diagnoses." };
  const [d] = await tx.select().from(residentDiagnoses).where(eq(residentDiagnoses.id, diagnosisId));
  if (!d || d.removedAt) return { ok: false, error: "That diagnosis was already removed." };
  if (!(await getResident(tx, actor, d.residentId))) return { ok: false, error: "That resident isn't available." };
  const why = reason.trim() || "Resolved";
  await tx.update(residentDiagnoses).set({ removedAt: new Date(), removedBy: actor.id, removeReason: why }).where(eq(residentDiagnoses.id, d.id));
  await audit(tx, { orgId: d.orgId, actorId: actor.id, action: "diagnosis_removed", entity: "resident", entityId: d.residentId, details: { code: d.code, reason: why } });
  return { ok: true, message: `${d.code} removed. It stays in the diagnosis history.` };
}
