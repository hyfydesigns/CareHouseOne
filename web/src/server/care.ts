import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { facilities, progressNotes, residents, shiftPunches, users, vitalReviews, vitals, type Resident } from "@/db/schema";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { addDays, daysInMonth, localDate, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { getResident, type Result } from "./residents";

async function tzOf(tx: Tx, facilityId: string): Promise<string> {
  const [f] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, facilityId));
  return f?.tz ?? "America/New_York";
}

/** UTC bounds of a calendar month in a home's time zone. */
async function monthBounds(tx: Tx, facilityId: string, year: number, month: number) {
  const tz = await tzOf(tx, facilityId);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  return { tz, from: zonedToUtc(first, "00:00", tz), to: zonedToUtc(addDays(last, 1), "00:00", tz) };
}

// ---------------------------------------------------------------- vital signs

/** Outside these, the reading is flagged and the nurse is alerted. Clinical review should confirm them. */
export const VITAL_LIMITS = { systolicHigh: 160, systolicLow: 90, pulseHigh: 110, pulseLow: 50, feverTenthsF: 1004, oxygenLow: 92 };

const num = (lo: number, hi: number, what: string) =>
  z.preprocess((v) => (v === "" || v == null ? undefined : v), z.coerce.number().min(lo, `${what} doesn't look possible.`).max(hi, `${what} doesn't look possible.`).optional());

export const vitalsSchema = z.object({
  residentId: z.string().uuid(),
  systolic: num(60, 260, "The top blood pressure number"),
  diastolic: num(30, 160, "The bottom blood pressure number"),
  pulse: num(25, 220, "The pulse"),
  temperature: num(90, 108, "The temperature"),
  respirations: num(4, 60, "The breathing rate"),
  oxygen: num(50, 100, "The oxygen level"),
  weight: num(40, 700, "The weight"),
  note: z.string().trim().max(300).optional(),
});

export function vitalFlags(v: { systolic: number; pulse: number; tempTenthsF?: number | null; oxygen?: number | null }): string[] {
  const f: string[] = [];
  if (v.systolic >= VITAL_LIMITS.systolicHigh || v.systolic < VITAL_LIMITS.systolicLow) f.push("blood pressure");
  if (v.pulse > VITAL_LIMITS.pulseHigh || v.pulse < VITAL_LIMITS.pulseLow) f.push("pulse");
  if (v.tempTenthsF != null && v.tempTenthsF >= VITAL_LIMITS.feverTenthsF) f.push("temperature");
  if (v.oxygen != null && v.oxygen < VITAL_LIMITS.oxygenLow) f.push("oxygen");
  return f;
}

/** `clientId` is set for entries made offline on a tablet, so a retried sync can't save them twice. */
export interface EntryOpts {
  clientId?: string;
}

export async function recordVitals(tx: Tx, actor: Actor, raw: unknown, now: Date, opts: EntryOpts = {}): Promise<Result<{ flags: string[] }>> {
  const p = vitalsSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  if (v.systolic == null || v.diastolic == null || v.pulse == null) return { ok: false, error: "Enter blood pressure (top and bottom) and pulse." };
  const r = await getResident(tx, actor, v.residentId);
  if (!r || r.status !== "active") return { ok: false, error: "That resident isn't available." };
  const tempTenthsF = v.temperature == null ? null : Math.round(v.temperature * 10);
  const flags = vitalFlags({ systolic: v.systolic, pulse: v.pulse, tempTenthsF, oxygen: v.oxygen ?? null });
  const [row] = await tx
    .insert(vitals)
    .values({
      orgId: r.orgId,
      residentId: r.id,
      systolic: v.systolic,
      diastolic: v.diastolic,
      pulse: v.pulse,
      tempTenthsF,
      respirations: v.respirations ?? null,
      oxygen: v.oxygen ?? null,
      weightTenthsLb: v.weight == null ? null : Math.round(v.weight * 10),
      flags,
      note: v.note || null,
      recordedBy: actor.id,
      recordedAt: now,
      clientId: opts.clientId ?? null,
    })
    .returning();
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: flags.length ? "vitals_out_of_range" : "vitals_recorded", entity: "resident", entityId: r.id, details: { vitalId: row.id, flags, ...(opts.clientId && { offline: true }) } });
  const msg = flags.length
    ? `Saved. ${flags.join(" and ").replace(/^./, (c) => c.toUpperCase())} outside the usual range: tell the nurse now. It's flagged for review.`
    : `Vital signs saved for ${r.firstName}.`;
  return { ok: true, message: msg, data: { flags } };
}

export async function monthVitals(tx: Tx, resident: Resident, year: number, month: number) {
  const { tz, from, to } = await monthBounds(tx, resident.facilityId, year, month);
  const rows = await tx
    .select({ v: vitals, by: users.name, reviewedAt: vitalReviews.reviewedAt })
    .from(vitals)
    .leftJoin(users, eq(users.id, vitals.recordedBy))
    .leftJoin(vitalReviews, eq(vitalReviews.vitalId, vitals.id))
    .where(and(eq(vitals.residentId, resident.id), gte(vitals.recordedAt, from), lt(vitals.recordedAt, to)))
    .orderBy(desc(vitals.recordedAt));
  const avg = (k: "systolic" | "diastolic") => (rows.length ? Math.round(rows.reduce((s, r) => s + r.v[k], 0) / rows.length) : null);
  return { tz, rows, averageBp: rows.length ? `${avg("systolic")}/${avg("diastolic")}` : null, flagged: rows.filter((r) => r.v.flags.length).length };
}

/** Flagged readings no nurse has reviewed yet, in the actor's homes. */
export async function unreviewedVitals(tx: Tx, actor: Actor) {
  const rows = await tx
    .select({ v: vitals, r: residents, by: users.name })
    .from(vitals)
    .innerJoin(residents, eq(residents.id, vitals.residentId))
    .leftJoin(users, eq(users.id, vitals.recordedBy))
    .leftJoin(vitalReviews, eq(vitalReviews.vitalId, vitals.id))
    .where(isNull(vitalReviews.vitalId))
    .orderBy(desc(vitals.recordedAt));
  return rows.filter((x) => x.v.flags.length > 0 && canSeeFacility(actor, x.r.facilityId));
}

export async function reviewVital(tx: Tx, actor: Actor, vitalId: string, note: string): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can review readings." };
  const [v] = await tx.select().from(vitals).where(eq(vitals.id, vitalId));
  if (!v || !(await getResident(tx, actor, v.residentId))) return { ok: false, error: "That reading isn't available." };
  const [done] = await tx.select().from(vitalReviews).where(eq(vitalReviews.vitalId, vitalId));
  if (done) return { ok: false, error: "That reading was already reviewed." };
  await tx.insert(vitalReviews).values({ vitalId, orgId: v.orgId, reviewedBy: actor.id, note: note.trim() || null });
  await audit(tx, { orgId: v.orgId, actorId: actor.id, action: "vitals_reviewed", entity: "resident", entityId: v.residentId, details: { vitalId } });
  return { ok: true, message: "Marked as reviewed." };
}

// ---------------------------------------------------------------- progress notes

export const CATEGORY_LABEL = { general: "General", activity: "Activity", health: "Health", behavior: "Behavior", family_contact: "Family contact" } as const;
export const SHIFT_LABEL = { day: "Day", evening: "Evening", night: "Night" } as const;

export function shiftAt(localHHMM: string): "day" | "evening" | "night" {
  if (localHHMM >= "07:00" && localHHMM < "15:00") return "day";
  if (localHHMM >= "15:00" && localHHMM < "23:00") return "evening";
  return "night";
}

export const noteSchema = z.object({
  residentId: z.string().uuid(),
  shift: z.enum(["day", "evening", "night"]),
  category: z.enum(["general", "activity", "health", "behavior", "family_contact"]),
  body: z.string().trim().min(10, "Write a little more about the shift before saving.").max(4000),
  addendumTo: z.preprocess((v) => (v === "" ? undefined : v), z.string().uuid().optional()),
});

export async function addNote(tx: Tx, actor: Actor, raw: unknown, now: Date, opts: EntryOpts = {}): Promise<Result> {
  const p = noteSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  const r = await getResident(tx, actor, v.residentId);
  if (!r) return { ok: false, error: "That resident isn't available." };
  if (v.addendumTo) {
    const [orig] = await tx.select().from(progressNotes).where(eq(progressNotes.id, v.addendumTo));
    if (!orig || orig.residentId !== r.id) return { ok: false, error: "The note you're adding to isn't available." };
  }
  await tx.insert(progressNotes).values({ orgId: r.orgId, residentId: r.id, shift: v.shift, category: v.category, body: v.body, addendumTo: v.addendumTo ?? null, recordedBy: actor.id, recordedAt: now, clientId: opts.clientId ?? null });
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: v.addendumTo ? "note_addendum" : "note_added", entity: "resident", entityId: r.id, details: opts.clientId ? { offline: true } : undefined });
  return { ok: true, message: v.addendumTo ? "Addendum saved." : "Progress note saved." };
}

export async function monthNotes(tx: Tx, resident: Resident, year: number, month: number) {
  const { tz, from, to } = await monthBounds(tx, resident.facilityId, year, month);
  const rows = await tx
    .select({ n: progressNotes, by: users.name })
    .from(progressNotes)
    .leftJoin(users, eq(users.id, progressNotes.recordedBy))
    .where(and(eq(progressNotes.residentId, resident.id), gte(progressNotes.recordedAt, from), lt(progressNotes.recordedAt, to)))
    .orderBy(desc(progressNotes.recordedAt));
  return { tz, rows };
}

// ---------------------------------------------------------------- shift sign-in and sign-out

async function openPunch(tx: Tx, userId: string) {
  const [p] = await tx.select().from(shiftPunches).where(and(eq(shiftPunches.userId, userId), isNull(shiftPunches.signedOutAt)));
  return p ?? null;
}

export async function shiftStatus(tx: Tx, actor: Actor) {
  return openPunch(tx, actor.id);
}

/**
 * Starts a shift at one of the actor's homes. Production adds a location check (tablet registered
 * to the home, or geofence) so sign-in only works on site.
 */
/**
 * Shift sign-in is the location check: it only works on a tablet registered to a home, and the
 * shift is recorded at that tablet's home. Pass the device's home, or null for any other browser.
 */
export async function signInShift(tx: Tx, actor: Actor, orgId: string, deviceFacilityId: string | null, now: Date): Promise<Result> {
  if (!deviceFacilityId) return { ok: false, error: "Sign in to your shift on the home's tablet." };
  const facilityId = deviceFacilityId;
  if (!actor.facilityIds.includes(facilityId)) return { ok: false, error: "You're not assigned to the home this tablet belongs to." };
  const open = await openPunch(tx, actor.id);
  if (open) return { ok: false, error: "You're already signed in. Sign out first." };
  await tx.insert(shiftPunches).values({ orgId, userId: actor.id, facilityId, signedInAt: now });
  await audit(tx, { orgId, actorId: actor.id, action: "shift_signed_in", entity: "facility", entityId: facilityId });
  return { ok: true, message: "Signed in. Have a good shift." };
}

export async function signOutShift(tx: Tx, actor: Actor, now: Date): Promise<Result> {
  const open = await openPunch(tx, actor.id);
  if (!open) return { ok: false, error: "You're not signed in." };
  await tx.update(shiftPunches).set({ signedOutAt: now }).where(eq(shiftPunches.id, open.id));
  await audit(tx, { orgId: open.orgId, actorId: actor.id, action: "shift_signed_out", entity: "facility", entityId: open.facilityId });
  const hours = (now.getTime() - open.signedInAt.getTime()) / 3_600_000;
  return { ok: true, message: `Signed out. ${hours.toFixed(1)} hours this shift. Thanks for your work.` };
}

/** Who signed in at a home today (local date), newest first. */
export async function todayAtHome(tx: Tx, actor: Actor, facilityId: string, now: Date) {
  if (!canSeeFacility(actor, facilityId)) return [];
  const tz = await tzOf(tx, facilityId);
  const today = localDate(now, tz);
  const from = zonedToUtc(addDays(today, -1), "12:00", tz);
  const rows = await tx
    .select({ p: shiftPunches, name: users.name, role: users.role })
    .from(shiftPunches)
    .innerJoin(users, eq(users.id, shiftPunches.userId))
    .where(and(eq(shiftPunches.facilityId, facilityId), gte(shiftPunches.signedInAt, from)))
    .orderBy(desc(shiftPunches.signedInAt));
  return rows.filter((r) => !r.p.signedOutAt || localDate(r.p.signedOutAt, tz) === today || localDate(r.p.signedInAt, tz) === today);
}

/** The actor's own shifts in a month, with hours. */
export async function myShifts(tx: Tx, actor: Actor, facilityId: string, year: number, month: number) {
  const { tz, from, to } = await monthBounds(tx, facilityId, year, month);
  const rows = await tx
    .select()
    .from(shiftPunches)
    .where(and(eq(shiftPunches.userId, actor.id), gte(shiftPunches.signedInAt, from), lt(shiftPunches.signedInAt, to)))
    .orderBy(desc(shiftPunches.signedInAt));
  const hours = (p: (typeof rows)[number]) => (p.signedOutAt ? (p.signedOutAt.getTime() - p.signedInAt.getTime()) / 3_600_000 : null);
  return { tz, rows: rows.map((p) => ({ ...p, hours: hours(p) })), total: rows.reduce((s, p) => s + (hours(p) ?? 0), 0) };
}

export async function homesFor(tx: Tx, actor: Actor) {
  const all = await tx.select().from(facilities).where(inArray(facilities.id, actor.facilityIds.length ? actor.facilityIds : ["00000000-0000-0000-0000-000000000000"])).orderBy(asc(facilities.name));
  return all;
}
