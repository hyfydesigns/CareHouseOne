import { and, asc, desc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { appointments, facilities, organizations, residents, users } from "@/db/schema";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { appBaseUrl } from "@/lib/hosts";
import { addDays, isDate, isTime, localDate, localTime, zonedToUtc } from "@/lib/time";
import { audit, sendMail } from "./audit";
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

/** How far ahead the caregiver tablets show an appointment, and how long after its time. */
export const SOON_HOURS = 3;
const AFTER_HOURS = 1;

/** Appointments at these homes starting in the next few hours (or just started), for the tablet banner. */
export async function appointmentsSoon(tx: Tx, actor: Actor, facilityIds: string[], now: Date) {
  const rows = await upcomingAppointments(tx, actor, facilityIds, now, 1);
  const from = now.getTime() - AFTER_HOURS * 3_600_000;
  const to = now.getTime() + SOON_HOURS * 3_600_000;
  return rows.filter((r) => r.a.scheduledAt.getTime() >= from && r.a.scheduledAt.getTime() <= to);
}

/**
 * The daily appointments email to owners and admins, sent by the cron job: in the evening for
 * tomorrow, or in the morning for today, as each organization chooses. It gives only counts per
 * home (no names or reasons), so no health information goes out by email. Each day is sent once,
 * and a day with no appointments sends nothing.
 */
export async function remindAppointments(db: DB, now: Date): Promise<number> {
  const orgs = await db.select({ id: organizations.id, when: organizations.appointmentReminders, last: organizations.appointmentDigestOn }).from(organizations);
  let sent = 0;
  for (const o of orgs) {
    if (o.when !== "evening" && o.when !== "morning") continue;
    const homes = await db.select({ id: facilities.id, name: facilities.name, tz: facilities.timeZone }).from(facilities).where(eq(facilities.orgId, o.id)).orderBy(asc(facilities.createdAt));
    if (!homes.length) continue;
    const tz = homes[0].tz;
    const hour = Number(localTime(now, tz).slice(0, 2));
    const today = localDate(now, tz);
    const day = o.when === "evening" ? (hour >= 17 && hour < 23 ? addDays(today, 1) : null) : hour >= 6 && hour < 11 ? today : null;
    if (!day || o.last === day) continue;
    await db.update(organizations).set({ appointmentDigestOn: day }).where(eq(organizations.id, o.id));
    const rows = await db
      .select({ facilityId: appointments.facilityId, at: appointments.scheduledAt })
      .from(appointments)
      .where(and(eq(appointments.orgId, o.id), eq(appointments.status, "scheduled"), gte(appointments.scheduledAt, new Date(now.getTime() - 86_400_000)), lt(appointments.scheduledAt, new Date(now.getTime() + 3 * 86_400_000))));
    const perHome = homes.map((h) => ({ name: h.name, n: rows.filter((r) => r.facilityId === h.id && localDate(r.at, h.tz) === day).length })).filter((h) => h.n);
    const total = perHome.reduce((n, h) => n + h.n, 0);
    if (!total) continue;
    const plural = (n: number) => `${n} appointment${n === 1 ? "" : "s"}`;
    const when = o.when === "evening" ? "Tomorrow" : "Today";
    const subject = `${when}: ${plural(total)} at your homes`;
    const body = [
      `${when} (${day}):`,
      ...perHome.map((h) => `- ${h.name}: ${plural(h.n)}`),
      "",
      `Sign in to CareHouse One to see who, when and where: ${appBaseUrl()}/dashboard`,
      "",
      "To keep residents' health information private, this email doesn't include names or details. Change when it comes under Settings > Appointment reminders.",
    ].join("\n");
    const to = await db.select({ email: users.email }).from(users).where(and(eq(users.orgId, o.id), inArray(users.role, ["owner", "admin"]), eq(users.status, "active")));
    for (const { email } of to) await sendMail(db, { orgId: o.id, to: email, subject, body });
    sent++;
  }
  return sent;
}
