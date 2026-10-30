import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  adlEntries,
  administrations,
  appointments,
  facilities,
  incidents,
  medicationOrders,
  prnFollowups,
  progressNotes,
  residentDiagnoses,
  residentPhotos,
  residents,
  vitals,
  type Resident,
} from "@/db/schema";
import { randomBytes } from "node:crypto";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { isDate } from "@/lib/time";
import { audit } from "./audit";

export type Result<T = undefined> = { ok: true; message: string; data?: T } | { ok: false; error: string };

/** Short, unambiguous code for wristbands (no 0/O or 1/I). */
export function newWristbandCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return "R-" + Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function visibleFacilities(tx: Tx, actor: Actor) {
  const all = await tx.select().from(facilities).orderBy(asc(facilities.name));
  return all.filter((f) => canSeeFacility(actor, f.id));
}

export async function listResidents(tx: Tx, actor: Actor, facilityId?: string): Promise<Resident[]> {
  const homes = (await visibleFacilities(tx, actor)).map((f) => f.id).filter((id) => !facilityId || id === facilityId);
  if (!homes.length) return [];
  return tx
    .select()
    .from(residents)
    .where(and(inArray(residents.facilityId, homes), eq(residents.status, "active")))
    .orderBy(asc(residents.room), asc(residents.lastName));
}

/** A resident the actor may see, or null. */
export async function getResident(tx: Tx, actor: Actor, residentId: string): Promise<Resident | null> {
  if (!z.string().uuid().safeParse(residentId).success) return null;
  const [r] = await tx.select().from(residents).where(eq(residents.id, residentId));
  return r && canSeeFacility(actor, r.facilityId) ? r : null;
}

const list = z
  .string()
  .optional()
  .transform((s) => (s ?? "").split(/[,\n]/).map((x) => x.trim()).filter(Boolean));

/** Optional phone number: digits with the usual separators, 7 to 25 characters. */
const phone = (whose: string) =>
  z
    .string()
    .trim()
    .max(25)
    .optional()
    .refine((s) => !s || (/^[0-9()+\-.\s]{7,25}$/.test(s) && (s.match(/\d/g) ?? []).length >= 7), `Enter ${whose} phone number, for example (555) 123-4567.`);

export const residentSchema = z.object({
  facilityId: z.string().uuid("Choose a home."),
  firstName: z.string().trim().min(1, "Enter a first name.").max(80),
  lastName: z.string().trim().min(1, "Enter a last name.").max(80),
  room: z.string().trim().max(20).default(""),
  dateOfBirth: z.string().trim().optional().refine((s) => !s || isDate(s), "Enter the date of birth as YYYY-MM-DD."),
  allergies: list,
  diet: z.string().trim().max(120).default("Regular"),
  codeStatus: z.string().trim().max(60).default("Full code"),
  guardian: z.string().trim().max(160).optional(),
  guardianRelationship: z.string().trim().max(80).optional(),
  guardianPhone: phone("the guardian's"),
  guardianEmail: z
    .string()
    .trim()
    .toLowerCase()
    .optional()
    .refine((s) => !s || z.string().email().safeParse(s).success, "Enter the guardian's email like name@example.com."),
  emergencyName: z.string().trim().max(160).optional(),
  emergencyRelationship: z.string().trim().max(80).optional(),
  emergencyPhone: phone("the emergency contact's"),
  admittedOn: z.string().trim().optional().refine((s) => !s || isDate(s), "Enter the admission date as YYYY-MM-DD."),
});

/** Guardian and emergency contact details; blank fields are stored as empty. */
function contacts(v: z.infer<typeof residentSchema>) {
  return {
    guardianRelationship: v.guardianRelationship || null,
    guardianPhone: v.guardianPhone || null,
    guardianEmail: v.guardianEmail || null,
    emergencyName: v.emergencyName || null,
    emergencyRelationship: v.emergencyRelationship || null,
    emergencyPhone: v.emergencyPhone || null,
  };
}

export async function createResident(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result<{ id: string }>> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can add residents." };
  const p = residentSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  if (!canSeeFacility(actor, v.facilityId)) return { ok: false, error: "You can't add residents to that home." };
  const [r] = await tx
    .insert(residents)
    .values({
      orgId,
      facilityId: v.facilityId,
      firstName: v.firstName,
      lastName: v.lastName,
      room: v.room,
      dateOfBirth: v.dateOfBirth || null,
      wristbandCode: newWristbandCode(),
      allergies: v.allergies,
      diet: v.diet || "Regular",
      codeStatus: v.codeStatus || "Full code",
      guardian: v.guardian || null,
      ...contacts(v),
      admittedOn: v.admittedOn || null,
    })
    .returning();
  await audit(tx, { orgId, actorId: actor.id, action: "resident_added", entity: "resident", entityId: r.id, details: { facilityId: v.facilityId } });
  return { ok: true, message: `${v.firstName} ${v.lastName} added. Print their wristband code: ${r.wristbandCode}.`, data: { id: r.id } };
}

export const residentName = (r: Pick<Resident, "firstName" | "lastName">) => `${r.firstName} ${r.lastName}`;

/** Discharged residents in the actor's homes, most recent first (for readmission and records). */
export async function listDischarged(tx: Tx, actor: Actor): Promise<Resident[]> {
  const homes = (await visibleFacilities(tx, actor)).map((f) => f.id);
  if (!homes.length) return [];
  const rows = await tx.select().from(residents).where(and(inArray(residents.facilityId, homes), eq(residents.status, "discharged")));
  return rows.sort((a, b) => (b.dischargedOn ?? "").localeCompare(a.dischargedOn ?? ""));
}

const EDITABLE = [
  "facilityId",
  "firstName",
  "lastName",
  "room",
  "dateOfBirth",
  "allergies",
  "diet",
  "codeStatus",
  "guardian",
  "guardianRelationship",
  "guardianPhone",
  "guardianEmail",
  "emergencyName",
  "emergencyRelationship",
  "emergencyPhone",
  "admittedOn",
] as const;

/**
 * Changes a resident's details. The audit log records which fields changed (and, for allergies,
 * the old and new list, since they drive the medication safety stops).
 */
export async function updateResident(tx: Tx, actor: Actor, residentId: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can change resident details." };
  const r = await getResident(tx, actor, residentId);
  if (!r) return { ok: false, error: "That resident isn't available." };
  const p = residentSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  if (!canSeeFacility(actor, v.facilityId)) return { ok: false, error: "You can't move residents to that home." };
  const next = {
    facilityId: v.facilityId,
    firstName: v.firstName,
    lastName: v.lastName,
    room: v.room,
    dateOfBirth: v.dateOfBirth || null,
    allergies: v.allergies,
    diet: v.diet || "Regular",
    codeStatus: v.codeStatus || "Full code",
    guardian: v.guardian || null,
    ...contacts(v),
    admittedOn: v.admittedOn || null,
  };
  const changed = EDITABLE.filter((k) => JSON.stringify(next[k]) !== JSON.stringify(r[k]));
  if (!changed.length) return { ok: true, message: "Nothing changed." };
  await tx.update(residents).set(next).where(eq(residents.id, r.id));
  await audit(tx, {
    orgId: r.orgId,
    actorId: actor.id,
    action: "resident_updated",
    entity: "resident",
    entityId: r.id,
    details: { fields: changed, ...(changed.includes("allergies") && { allergiesBefore: r.allergies, allergiesAfter: next.allergies }) },
  });
  return { ok: true, message: "Saved." };
}

const dischargeSchema = z.object({
  date: z.string().trim().refine(isDate, "Enter the discharge date as YYYY-MM-DD."),
  reason: z.string().trim().min(2, "Give a reason, for example moved to another provider.").max(300),
});

/**
 * Discharge: the resident leaves the medication pass and the tablet. Nothing is deleted; their
 * records stay readable, and they can be readmitted.
 */
export async function dischargeResident(tx: Tx, actor: Actor, residentId: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can discharge residents." };
  const r = await getResident(tx, actor, residentId);
  if (!r || r.status !== "active") return { ok: false, error: "That resident isn't currently admitted." };
  const p = dischargeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await tx.update(residents).set({ status: "discharged", dischargedOn: p.data.date, dischargeReason: p.data.reason }).where(eq(residents.id, r.id));
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "resident_discharged", entity: "resident", entityId: r.id, details: { date: p.data.date, reason: p.data.reason } });
  return { ok: true, message: `${residentName(r)} is discharged. Their records stay available under Residents > Discharged.` };
}

/**
 * A resident can only be deleted while nothing has been recorded for them: no medication orders
 * (so no doses or follow-ups), vital signs, progress notes, diagnoses, incident reports or appointments. Anything else is a care
 * record that must be kept, so the resident is discharged instead.
 */
export async function hasCareRecords(tx: Tx, residentId: string): Promise<boolean> {
  const tables = [medicationOrders, administrations, prnFollowups, vitals, progressNotes, residentDiagnoses, incidents, appointments, adlEntries];
  for (const t of tables) {
    const [row] = await tx.select({ id: t.residentId }).from(t).where(eq(t.residentId, residentId)).limit(1);
    if (row) return true;
  }
  return false;
}

/** For a resident added by mistake (a test or a duplicate). Owners only; the audit log keeps who, when and why. */
export async function deleteResident(tx: Tx, actor: Actor, residentId: string, raw: unknown): Promise<Result> {
  if (actor.role !== "owner") return { ok: false, error: "Only owners can delete residents." };
  const r = await getResident(tx, actor, residentId);
  if (!r) return { ok: false, error: "That resident doesn't exist." };
  const p = z.object({ reason: z.string().trim().min(3, "Say why, for example: added twice by mistake.").max(300) }).safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (await hasCareRecords(tx, r.id)) {
    return { ok: false, error: `${residentName(r)} already has care records, which must be kept. Discharge them instead.` };
  }
  await tx.delete(residentPhotos).where(eq(residentPhotos.residentId, r.id));
  await tx.delete(residents).where(eq(residents.id, r.id));
  await audit(tx, {
    orgId: r.orgId,
    actorId: actor.id,
    action: "resident_deleted",
    entity: "resident",
    entityId: r.id,
    details: { name: residentName(r), facilityId: r.facilityId, admittedOn: r.admittedOn, reason: p.data.reason },
  });
  return { ok: true, message: `${residentName(r)} is deleted.` };
}

export async function readmitResident(tx: Tx, actor: Actor, residentId: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can readmit residents." };
  const r = await getResident(tx, actor, residentId);
  if (!r || r.status !== "discharged") return { ok: false, error: "That resident isn't discharged." };
  const p = z.object({ date: z.string().trim().refine(isDate, "Enter the readmission date as YYYY-MM-DD.") }).safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await tx.update(residents).set({ status: "active", admittedOn: p.data.date, dischargedOn: null, dischargeReason: null }).where(eq(residents.id, r.id));
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "resident_readmitted", entity: "resident", entityId: r.id, details: { date: p.data.date } });
  return { ok: true, message: `${residentName(r)} is readmitted. Check their medication orders before the next pass.` };
}
