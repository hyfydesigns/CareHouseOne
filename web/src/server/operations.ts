import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { facilities, handoffNotes, safetyChecks, users } from "@/db/schema";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { isDate, isTime, localTime, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { shiftAt } from "./care";
import type { Result } from "./residents";

const DAY = 86_400_000;

// ---------------------------------------------------------------- shift handoff notes

/** How far back the handoff panel looks: roughly the last two shifts. */
export const HANDOFF_HOURS = 16;

const handoffSchema = z.object({
  facilityId: z.string().uuid("Choose the home."),
  body: z.string().trim().min(3, "Write what the next shift needs to know.").max(2000),
});

/** Anyone working at the home leaves a note for the next shift. Permanent once saved. */
export async function addHandoff(tx: Tx, actor: Actor, orgId: string, raw: unknown, now: Date): Promise<Result> {
  const p = handoffSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!canSeeFacility(actor, p.data.facilityId)) return { ok: false, error: "You're not assigned to that home." };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, p.data.facilityId));
  if (!home) return { ok: false, error: "Choose the home." };
  const shift = shiftAt(localTime(now, home.timeZone));
  const [row] = await tx.insert(handoffNotes).values({ orgId, facilityId: home.id, shift, body: p.data.body, recordedBy: actor.id, recordedAt: now }).returning();
  await audit(tx, { orgId, actorId: actor.id, action: "handoff_added", entity: "facility", entityId: home.id, details: { noteId: row.id } });
  return { ok: true, message: "Saved. The next shift will see it when they sign in." };
}

/** The latest handoff notes at a home, newest first. */
export async function recentHandoffs(tx: Tx, actor: Actor, facilityId: string, now: Date, hours = HANDOFF_HOURS) {
  if (!canSeeFacility(actor, facilityId)) return [];
  return tx
    .select({ n: handoffNotes, by: users.name })
    .from(handoffNotes)
    .leftJoin(users, eq(users.id, handoffNotes.recordedBy))
    .where(and(eq(handoffNotes.facilityId, facilityId), gte(handoffNotes.recordedAt, new Date(now.getTime() - hours * 3_600_000))))
    .orderBy(desc(handoffNotes.recordedAt));
}

// ---------------------------------------------------------------- fire drills and safety checks

/**
 * The checks a home records, and how often each is due. Most states want a fire drill every month
 * (rotating shifts so each shift drills at least quarterly); check your state's rules.
 */
export const SAFETY_KINDS = {
  fire_drill: { label: "Fire drill", everyDays: 31 },
  smoke_detectors: { label: "Smoke detector test", everyDays: 31 },
  fire_extinguisher: { label: "Fire extinguisher check", everyDays: 31 },
  emergency_supplies: { label: "Emergency supplies check", everyDays: 92 },
  other: { label: "Other safety check", everyDays: 0 },
} as const;
export type SafetyKind = keyof typeof SAFETY_KINDS;

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optInt = (max: number) =>
  z
    .union([z.literal(""), z.coerce.number().int("Use a whole number.").min(0).max(max)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v));

const safetySchema = z.object({
  facilityId: z.string().uuid("Choose the home."),
  kind: z.enum(Object.keys(SAFETY_KINDS) as [SafetyKind, ...SafetyKind[]], { message: "Choose what was checked." }),
  date: z.string().refine(isDate, "Enter the date."),
  time: z.string().refine(isTime, "Enter the time."),
  participants: optInt(100),
  durationMinutes: optInt(240),
  issues: opt(2000),
});

export async function recordSafetyCheck(tx: Tx, actor: Actor, orgId: string, raw: unknown, now: Date): Promise<Result> {
  const p = safetySchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  if (!canSeeFacility(actor, d.facilityId)) return { ok: false, error: "You're not assigned to that home." };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, d.facilityId));
  if (!home) return { ok: false, error: "Choose the home." };
  if (d.kind === "other" && !d.issues) return { ok: false, error: "Say what was checked, in the notes." };
  const performedAt = zonedToUtc(d.date, d.time, home.timeZone);
  if (performedAt.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: "The time can't be in the future." };
  const [row] = await tx
    .insert(safetyChecks)
    .values({ orgId, facilityId: home.id, kind: d.kind, performedAt, shift: shiftAt(d.time), participants: d.participants, durationMinutes: d.durationMinutes, issues: d.issues, recordedBy: actor.id, recordedAt: now })
    .returning();
  await audit(tx, { orgId, actorId: actor.id, action: "safety_check_recorded", entity: "facility", entityId: home.id, details: { kind: d.kind, checkId: row.id } });
  return { ok: true, message: `${SAFETY_KINDS[d.kind].label} recorded.` };
}

export async function safetyLog(tx: Tx, actor: Actor, facilityIds: string[], since: Date) {
  const ids = facilityIds.filter((f) => canSeeFacility(actor, f));
  if (!ids.length) return [];
  return tx
    .select({ c: safetyChecks, by: users.name })
    .from(safetyChecks)
    .leftJoin(users, eq(users.id, safetyChecks.recordedBy))
    .where(and(inArray(safetyChecks.facilityId, ids), gte(safetyChecks.performedAt, since)))
    .orderBy(desc(safetyChecks.performedAt));
}

export interface SafetyStatus {
  kind: SafetyKind;
  label: string;
  last: Date | null;
  overdue: boolean;
  /** Fire drills: shifts with no drill in the last 92 days. */
  shiftsMissing: Array<"day" | "evening" | "night">;
}

/** For each home: when each check was last done and whether it's overdue. */
export async function safetyStatus(tx: Tx, actor: Actor, facilityId: string, now: Date): Promise<SafetyStatus[]> {
  const rows = await safetyLog(tx, actor, [facilityId], new Date(now.getTime() - 400 * DAY));
  return (Object.keys(SAFETY_KINDS) as SafetyKind[])
    .filter((k) => SAFETY_KINDS[k].everyDays > 0)
    .map((kind) => {
      const mine = rows.filter((r) => r.c.kind === kind);
      const last = mine[0]?.c.performedAt ?? null;
      const overdue = !last || now.getTime() - last.getTime() > SAFETY_KINDS[kind].everyDays * DAY;
      const recent = mine.filter((r) => now.getTime() - r.c.performedAt.getTime() <= 92 * DAY).map((r) => r.c.shift);
      const shiftsMissing = kind === "fire_drill" ? (["day", "evening", "night"] as const).filter((s) => !recent.includes(s)) : [];
      return { kind, label: SAFETY_KINDS[kind].label, last, overdue, shiftsMissing };
    });
}

/** Owner dashboard: homes with an overdue safety check. */
export async function overdueSafety(tx: Tx, actor: Actor, homes: Array<{ id: string; name: string }>, now: Date) {
  if (!canManageCare(actor)) return [];
  const out: Array<{ home: string; facilityId: string; overdue: string[] }> = [];
  for (const h of homes) {
    const overdue = (await safetyStatus(tx, actor, h.id, now)).filter((s) => s.overdue).map((s) => s.label);
    if (overdue.length) out.push({ home: h.name, facilityId: h.id, overdue });
  }
  return out;
}
