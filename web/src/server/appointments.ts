import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { appointments, facilities, residents, users } from "@/db/schema";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { isDate, isTime, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { getResident, type Result } from "./residents";

export const APPOINTMENT_STATUS = { scheduled: "Scheduled", done: "Done", cancelled: "Cancelled", missed: "Missed" } as const;
export type AppointmentStatus = keyof typeof APPOINTMENT_STATUS;

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

const appointmentSchema = z.object({
  date: z.string().refine(isDate, "Enter the date."),
  time: z.string().refine(isTime, "Enter the time."),
  provider: z.string().trim().min(2, "Who is the appointment with? For example: Dr. Patel, family doctor.").max(200),
  purpose: z.string().trim().min(2, "What is it for? For example: blood pressure check.").max(300),
  location: opt(300),
  notes: opt(1000),
});

/** Owners and admins schedule appointments (and change the date or time). */
export async function scheduleAppointment(tx: Tx, actor: Actor, residentId: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins schedule appointments." };
  const r = await getResident(tx, actor, residentId);
  if (!r || r.status !== "active") return { ok: false, error: "That resident isn't currently admitted." };
  const p = appointmentSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, r.facilityId));
  const { date, time, ...rest } = p.data;
  const [row] = await tx
    .insert(appointments)
    .values({ orgId: r.orgId, residentId: r.id, facilityId: r.facilityId, scheduledAt: zonedToUtc(date, time, home.timeZone), ...rest, createdBy: actor.id })
    .returning();
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "appointment_scheduled", entity: "resident", entityId: r.id, details: { appointmentId: row.id } });
  return { ok: true, message: "Appointment added." };
}

async function findAppointment(tx: Tx, actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [a] = await tx.select().from(appointments).where(eq(appointments.id, id));
  return a && canSeeFacility(actor, a.facilityId) ? a : null;
}

export async function rescheduleAppointment(tx: Tx, actor: Actor, id: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins change appointments." };
  const a = await findAppointment(tx, actor, id);
  if (!a || a.status !== "scheduled") return { ok: false, error: "That appointment can't be changed." };
  const p = appointmentSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, a.facilityId));
  const { date, time, ...rest } = p.data;
  const scheduledAt = zonedToUtc(date, time, home.timeZone);
  await tx.update(appointments).set({ scheduledAt, ...rest, updatedBy: actor.id, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  await audit(tx, { orgId: a.orgId, actorId: actor.id, action: "appointment_changed", entity: "resident", entityId: a.residentId, details: { appointmentId: a.id, before: a.scheduledAt.toISOString(), after: scheduledAt.toISOString() } });
  return { ok: true, message: "Appointment updated." };
}

const outcomeSchema = z.object({
  status: z.enum(["done", "cancelled", "missed"], { message: "Choose what happened." }),
  outcome: opt(3000),
  followUp: opt(1000),
});

/**
 * Whoever went (often a caregiver) records how it went: what the provider said, and anything that
 * follows from it, like new orders or the next appointment, for the owner or admin to act on.
 */
export async function recordAppointmentOutcome(tx: Tx, actor: Actor, id: string, raw: unknown): Promise<Result> {
  const a = await findAppointment(tx, actor, id);
  if (!a || a.status !== "scheduled") return { ok: false, error: "That appointment was already recorded." };
  const p = outcomeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.status === "done" && !p.data.outcome) return { ok: false, error: "Write what the provider said or did." };
  if (p.data.status !== "done" && !p.data.outcome) return { ok: false, error: "Say why it didn't happen." };
  await tx.update(appointments).set({ ...p.data, updatedBy: actor.id, updatedAt: new Date() }).where(eq(appointments.id, a.id));
  await audit(tx, { orgId: a.orgId, actorId: actor.id, action: `appointment_${p.data.status}`, entity: "resident", entityId: a.residentId, details: { appointmentId: a.id } });
  return { ok: true, message: p.data.followUp ? "Recorded. The owner and admins will see the follow-up on their dashboard." : "Recorded." };
}

export async function residentAppointments(tx: Tx, residentId: string) {
  return tx
    .select({ a: appointments, by: users.name })
    .from(appointments)
    .leftJoin(users, eq(users.id, appointments.updatedBy))
    .where(eq(appointments.residentId, residentId))
    .orderBy(desc(appointments.scheduledAt));
}

/** Upcoming (and overdue-to-record) appointments in the actor's homes, soonest first. */
export async function upcomingAppointments(tx: Tx, actor: Actor, facilityIds: string[], now: Date, days = 7) {
  const ids = facilityIds.filter((f) => canSeeFacility(actor, f));
  if (!ids.length) return [];
  const rows = await tx
    .select({ a: appointments, first: residents.firstName, last: residents.lastName, home: facilities.name, tz: facilities.timeZone })
    .from(appointments)
    .innerJoin(residents, eq(residents.id, appointments.residentId))
    .innerJoin(facilities, eq(facilities.id, appointments.facilityId))
    .where(and(inArray(appointments.facilityId, ids), eq(appointments.status, "scheduled"), gte(appointments.scheduledAt, new Date(now.getTime() - 14 * 86_400_000)), lt(appointments.scheduledAt, new Date(now.getTime() + days * 86_400_000))))
    .orderBy(asc(appointments.scheduledAt));
  return rows.map((r) => ({ ...r, resident: `${r.first} ${r.last}`, needsOutcome: r.a.scheduledAt.getTime() < now.getTime() - 2 * 3_600_000 }));
}

/** Done appointments with a follow-up written in the last 30 days, for owners and admins to act on. */
export async function appointmentFollowUps(tx: Tx, actor: Actor, now: Date) {
  if (!canManageCare(actor)) return [];
  const rows = await tx
    .select({ a: appointments, first: residents.firstName, last: residents.lastName })
    .from(appointments)
    .innerJoin(residents, eq(residents.id, appointments.residentId))
    .where(and(eq(appointments.status, "done"), gte(appointments.scheduledAt, new Date(now.getTime() - 30 * 86_400_000))))
    .orderBy(desc(appointments.scheduledAt));
  return rows.filter((r) => r.a.followUp && canSeeFacility(actor, r.a.facilityId)).map((r) => ({ ...r, resident: `${r.first} ${r.last}` }));
}

