import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { facilities, residents, type Resident } from "@/db/schema";
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
  admittedOn: z.string().trim().optional().refine((s) => !s || isDate(s), "Enter the admission date as YYYY-MM-DD."),
});

export async function createResident(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result<{ id: string }>> {
  if (!canManageCare(actor)) return { ok: false, error: "Only nurses and managers can add residents." };
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
      admittedOn: v.admittedOn || null,
    })
    .returning();
  await audit(tx, { orgId, actorId: actor.id, action: "resident_added", entity: "resident", entityId: r.id, details: { facilityId: v.facilityId } });
  return { ok: true, message: `${v.firstName} ${v.lastName} added. Print their wristband code: ${r.wristbandCode}.`, data: { id: r.id } };
}

export const residentName = (r: Pick<Resident, "firstName" | "lastName">) => `${r.firstName} ${r.lastName}`;
