import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { adlEntries, facilities, residents, users, type Resident } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { addDays, daysInMonth, localDate, localTime, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { monthBounds, shiftAt } from "./care";
import { getResident, type Result } from "./residents";

/** The activities of daily living recorded each shift. */
export const ADL_ACTIVITIES = {
  bathing: "Bathing or shower",
  dressing: "Dressing",
  grooming: "Grooming and oral care",
  toileting: "Toileting",
  continence: "Continence",
  eating: "Eating",
  mobility: "Mobility and transfers",
} as const;
export type AdlActivity = keyof typeof ADL_ACTIVITIES;

/**
 * How much help was needed, least to most. `letter` is what the monthly grid shows; `rank` picks
 * the day's entry when there are several (the most help given wins).
 */
export const SUPPORT_LEVELS = {
  independent: { label: "Independent", letter: "I", rank: 1 },
  supervision: { label: "Supervision or cues", letter: "S", rank: 2 },
  limited: { label: "Limited help", letter: "L", rank: 3 },
  extensive: { label: "Extensive help", letter: "E", rank: 4 },
  total: { label: "Total help", letter: "T", rank: 5 },
  refused: { label: "Refused", letter: "R", rank: 0 },
  not_needed: { label: "Not needed", letter: "–", rank: -1 },
} as const;
export type SupportLevel = keyof typeof SUPPORT_LEVELS;

const activities = Object.keys(ADL_ACTIVITIES) as AdlActivity[];
const levels = Object.keys(SUPPORT_LEVELS) as [SupportLevel, ...SupportLevel[]];

const adlSchema = z.object({
  residentId: z.string().uuid(),
  entries: z.record(z.string(), z.string()),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/**
 * Records this shift's ADLs for one resident: any activities the caregiver filled in. Anyone
 * working at the resident's home can record them. Permanent once saved.
 */
export async function recordAdl(tx: Tx, actor: Actor, raw: unknown, now: Date): Promise<Result> {
  const p = adlSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose how much help was needed for at least one activity." };
  const picked = activities.filter((a) => p.data.entries[a]).map((a) => ({ activity: a, support: p.data.entries[a] }));
  if (!picked.length) return { ok: false, error: "Choose how much help was needed for at least one activity." };
  if (picked.some((e) => !levels.includes(e.support as SupportLevel))) return { ok: false, error: "Choose one of the listed levels of help." };
  if (picked.some((e) => e.support === "refused") && !p.data.note) return { ok: false, error: "Add a note saying what was refused and what you tried." };
  const r = await getResident(tx, actor, p.data.residentId);
  if (!r || r.status !== "active") return { ok: false, error: "That resident isn't available." };
  const [home] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, r.facilityId));
  const shift = shiftAt(localTime(now, home.tz));
  await tx.insert(adlEntries).values(picked.map((e) => ({ orgId: r.orgId, residentId: r.id, shift, activity: e.activity, support: e.support, note: p.data.note, recordedBy: actor.id, recordedAt: now })));
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "adl_recorded", entity: "resident", entityId: r.id, details: { shift, activities: picked.map((e) => e.activity) } });
  return { ok: true, message: `Daily care saved for ${r.firstName} (${picked.length} ${picked.length === 1 ? "activity" : "activities"}, ${shift} shift).` };
}

/** The local day a shift belongs to: the night shift after midnight counts toward the day it started. */
function shiftDay(at: Date, tz: string): { date: string; shift: "day" | "evening" | "night" } {
  const time = localTime(at, tz);
  const shift = shiftAt(time);
  const date = localDate(at, tz);
  return { date: shift === "night" && time < "07:00" ? addDays(date, -1) : date, shift };
}

/** What has been recorded for the resident's current shift: the latest entry per activity. */
export async function currentShiftAdl(tx: Tx, resident: Resident, now: Date) {
  const [home] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, resident.facilityId));
  const here = shiftDay(now, home.tz);
  const rows = await tx
    .select({ e: adlEntries, by: users.name })
    .from(adlEntries)
    .leftJoin(users, eq(users.id, adlEntries.recordedBy))
    .where(and(eq(adlEntries.residentId, resident.id), gte(adlEntries.recordedAt, new Date(now.getTime() - 20 * 3_600_000))))
    .orderBy(asc(adlEntries.recordedAt));
  const latest = new Map<AdlActivity, { support: SupportLevel; by: string | null; at: Date; note: string | null }>();
  for (const { e, by } of rows) {
    const d = shiftDay(e.recordedAt, home.tz);
    if (d.date === here.date && d.shift === here.shift) latest.set(e.activity as AdlActivity, { support: e.support as SupportLevel, by, at: e.recordedAt, note: e.note });
  }
  return { shift: here.shift, tz: home.tz, latest };
}

export interface AdlMonth {
  days: number;
  tz: string;
  /** activity → one cell per day of the month: the most help given that day, or null. */
  grid: Record<AdlActivity, Array<SupportLevel | null>>;
  notes: Array<{ at: Date; shift: string; activity: AdlActivity; support: SupportLevel; note: string; by: string | null }>;
}

export async function monthAdl(tx: Tx, resident: Resident, year: number, month: number): Promise<AdlMonth> {
  const { tz, from, to } = await monthBounds(tx, resident.facilityId, year, month);
  const n = daysInMonth(year, month);
  const rows = await tx
    .select({ e: adlEntries, by: users.name })
    .from(adlEntries)
    .leftJoin(users, eq(users.id, adlEntries.recordedBy))
    .where(and(eq(adlEntries.residentId, resident.id), gte(adlEntries.recordedAt, from), lt(adlEntries.recordedAt, new Date(to.getTime() + 7 * 3_600_000))))
    .orderBy(asc(adlEntries.recordedAt));
  const grid = Object.fromEntries(activities.map((a) => [a, Array<SupportLevel | null>(n).fill(null)])) as AdlMonth["grid"];
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const notes: AdlMonth["notes"] = [];
  for (const { e, by } of rows) {
    const d = shiftDay(e.recordedAt, tz);
    if (!d.date.startsWith(prefix)) continue;
    const day = Number(d.date.slice(8)) - 1;
    const a = e.activity as AdlActivity;
    const s = e.support as SupportLevel;
    if (!grid[a]) continue;
    const cur = grid[a][day];
    if (!cur || SUPPORT_LEVELS[s].rank > SUPPORT_LEVELS[cur].rank) grid[a][day] = s;
    if (e.note && !notes.some((x) => x.note === e.note && Math.abs(x.at.getTime() - e.recordedAt.getTime()) < 1000)) {
      notes.push({ at: e.recordedAt, shift: e.shift, activity: a, support: s, note: e.note, by });
    }
  }
  return { days: n, tz, grid, notes: notes.reverse() };
}

/** Owner dashboard: how many of each home's residents have daily care recorded today. */
export async function adlTodayByHome(tx: Tx, facilityIds: string[], now: Date): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!facilityIds.length) return out;
  const homes = await tx.select({ id: facilities.id, tz: facilities.timeZone }).from(facilities).where(inArray(facilities.id, facilityIds));
  for (const h of homes) {
    const start = zonedToUtc(localDate(now, h.tz), "00:00", h.tz);
    const rows = await tx
      .selectDistinct({ residentId: adlEntries.residentId })
      .from(adlEntries)
      .innerJoin(residents, eq(residents.id, adlEntries.residentId))
      .where(and(eq(residents.facilityId, h.id), gte(adlEntries.recordedAt, start)));
    out.set(h.id, rows.length);
  }
  return out;
}
