import { and, asc, eq, gte, inArray, isNull, lt, max } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { adlActivities, adlEntries, facilities, residents, users, type Resident } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { addDays, daysInMonth, localDate, localTime, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { monthBounds, shiftAt } from "./care";
import { getResident, type Result } from "./residents";

/** The built-in activities of daily living, used until an owner or admin changes the list. */
export const ADL_ACTIVITIES = {
  bathing: "Bathing or shower",
  dressing: "Dressing",
  grooming: "Grooming and oral care",
  toileting: "Toileting",
  continence: "Continence",
  eating: "Eating",
  mobility: "Mobility and transfers",
} as const;
export type BuiltInActivity = keyof typeof ADL_ACTIVITIES;

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
const levels = Object.keys(SUPPORT_LEVELS) as SupportLevel[];

/** One activity as the app uses it. `key` is what entries store: the built-in key, or the added row's id. */
export interface Activity {
  key: string;
  name: string;
  builtIn: boolean;
  hidden: boolean;
}

const builtIns = (): Activity[] => Object.entries(ADL_ACTIVITIES).map(([key, name]) => ({ key, name, builtIn: true, hidden: false }));

/** The organization's activities in order (hidden ones only when asked for). */
export async function listActivities(tx: Tx, opts: { includeHidden?: boolean } = {}): Promise<Activity[]> {
  const rows = await tx.select().from(adlActivities).orderBy(asc(adlActivities.position));
  if (!rows.length) return builtIns();
  const all = rows.map((r) => ({ key: r.key ?? r.id, name: r.name, builtIn: !!r.key, hidden: !!r.hiddenAt }));
  return opts.includeHidden ? all : all.filter((a) => !a.hidden);
}

/** The first change to the list writes the built-ins down, so they can be hidden like any other. */
async function materialize(tx: Tx, orgId: string): Promise<void> {
  const [any] = await tx.select({ id: adlActivities.id }).from(adlActivities).limit(1);
  if (any) return;
  await tx.insert(adlActivities).values(Object.entries(ADL_ACTIVITIES).map(([key, name], i) => ({ orgId, key, name, position: i })));
}

const nameSchema = z.string().trim().min(2, "Name the activity, for example Laundry.").max(60, "Keep the name under 60 characters.");

/** Owners and admins add an activity everyone then records in daily care. */
export async function addActivity(tx: Tx, actor: Actor, orgId: string, rawName: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins change the daily care activities." };
  const p = nameSchema.safeParse(rawName);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  await materialize(tx, orgId);
  const existing = await tx.select().from(adlActivities);
  const same = existing.find((r) => r.name.toLowerCase() === p.data.toLowerCase());
  if (same && !same.hiddenAt) return { ok: false, error: `${same.name} is already on the list.` };
  if (same) {
    await tx.update(adlActivities).set({ hiddenAt: null }).where(eq(adlActivities.id, same.id));
    await audit(tx, { orgId, actorId: actor.id, action: "adl_activity_shown", entity: "organization", entityId: orgId, details: { name: same.name } });
    return { ok: true, message: `${same.name} is back on the list.` };
  }
  const [{ top }] = await tx.select({ top: max(adlActivities.position) }).from(adlActivities);
  const [row] = await tx.insert(adlActivities).values({ orgId, name: p.data, position: (top ?? 0) + 1, createdBy: actor.id }).returning();
  await audit(tx, { orgId, actorId: actor.id, action: "adl_activity_added", entity: "organization", entityId: orgId, details: { name: row.name, activityId: row.id } });
  return { ok: true, message: `${row.name} added. Caregivers will see it in daily care.` };
}

/** Hide an activity nobody needs to record any more, or show it again. Its history stays. */
export async function setActivityHidden(tx: Tx, actor: Actor, orgId: string, key: string, hidden: boolean): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins change the daily care activities." };
  await materialize(tx, orgId);
  const rows = await tx.select().from(adlActivities);
  const row = rows.find((r) => (r.key ?? r.id) === key);
  if (!row) return { ok: false, error: "That activity isn't on the list." };
  if (hidden && rows.filter((r) => !r.hiddenAt && r.id !== row.id).length === 0) return { ok: false, error: "Keep at least one activity." };
  await tx.update(adlActivities).set({ hiddenAt: hidden ? new Date() : null }).where(eq(adlActivities.id, row.id));
  await audit(tx, { orgId, actorId: actor.id, action: hidden ? "adl_activity_hidden" : "adl_activity_shown", entity: "organization", entityId: orgId, details: { name: row.name } });
  return { ok: true, message: hidden ? `${row.name} is hidden. Its past records stay.` : `${row.name} is back on the list.` };
}

const adlSchema = z.object({
  residentId: z.string().uuid(),
  entries: z.record(z.string(), z.string()),
  note: z.string().trim().max(1000).optional().transform((v) => v || null),
});

/**
 * Records this shift's ADLs for one resident: any of the organization's activities the caregiver
 * filled in. Anyone working at the resident's home can record them. Permanent once saved.
 */
export async function recordAdl(tx: Tx, actor: Actor, raw: unknown, now: Date): Promise<Result> {
  const p = adlSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose how much help was needed for at least one activity." };
  const active = await listActivities(tx);
  const picked = active.filter((a) => p.data.entries[a.key]).map((a) => ({ activity: a.key, support: p.data.entries[a.key] }));
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

/** What has been recorded for the resident's current shift: the latest entry per activity key. */
export async function currentShiftAdl(tx: Tx, resident: Resident, now: Date) {
  const [home] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, resident.facilityId));
  const here = shiftDay(now, home.tz);
  const rows = await tx
    .select({ e: adlEntries, by: users.name })
    .from(adlEntries)
    .leftJoin(users, eq(users.id, adlEntries.recordedBy))
    .where(and(eq(adlEntries.residentId, resident.id), gte(adlEntries.recordedAt, new Date(now.getTime() - 20 * 3_600_000))))
    .orderBy(asc(adlEntries.recordedAt));
  const latest = new Map<string, { support: SupportLevel; by: string | null; at: Date; note: string | null }>();
  for (const { e, by } of rows) {
    const d = shiftDay(e.recordedAt, home.tz);
    if (d.date === here.date && d.shift === here.shift) latest.set(e.activity, { support: e.support as SupportLevel, by, at: e.recordedAt, note: e.note });
  }
  return { shift: here.shift, tz: home.tz, latest };
}

export interface AdlMonth {
  days: number;
  tz: string;
  /** One row per activity (current ones, plus hidden ones recorded that month): the most help given each day. */
  rows: Array<{ key: string; name: string; hidden: boolean; cells: Array<SupportLevel | null> }>;
  notes: Array<{ at: Date; shift: string; activity: string; support: SupportLevel; note: string; by: string | null }>;
}

export async function monthAdl(tx: Tx, resident: Resident, year: number, month: number): Promise<AdlMonth> {
  const { tz, from, to } = await monthBounds(tx, resident.facilityId, year, month);
  const n = daysInMonth(year, month);
  const all = await listActivities(tx, { includeHidden: true });
  const entries = await tx
    .select({ e: adlEntries, by: users.name })
    .from(adlEntries)
    .leftJoin(users, eq(users.id, adlEntries.recordedBy))
    .where(and(eq(adlEntries.residentId, resident.id), gte(adlEntries.recordedAt, from), lt(adlEntries.recordedAt, new Date(to.getTime() + 7 * 3_600_000))))
    .orderBy(asc(adlEntries.recordedAt));
  const cells = new Map<string, Array<SupportLevel | null>>();
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const notes: AdlMonth["notes"] = [];
  for (const { e, by } of entries) {
    const d = shiftDay(e.recordedAt, tz);
    if (!d.date.startsWith(prefix)) continue;
    const day = Number(d.date.slice(8)) - 1;
    const s = e.support as SupportLevel;
    const row = cells.get(e.activity) ?? Array<SupportLevel | null>(n).fill(null);
    const cur = row[day];
    if (!cur || SUPPORT_LEVELS[s].rank > SUPPORT_LEVELS[cur].rank) row[day] = s;
    cells.set(e.activity, row);
    if (e.note && !notes.some((x) => x.note === e.note && Math.abs(x.at.getTime() - e.recordedAt.getTime()) < 1000)) {
      notes.push({ at: e.recordedAt, shift: e.shift, activity: e.activity, support: s, note: e.note, by });
    }
  }
  const nameOf = (key: string) => all.find((a) => a.key === key)?.name ?? ADL_ACTIVITIES[key as BuiltInActivity] ?? "Removed activity";
  const rows = all
    .filter((a) => !a.hidden || cells.has(a.key))
    .map((a) => ({ key: a.key, name: a.name, hidden: a.hidden, cells: cells.get(a.key) ?? Array<SupportLevel | null>(n).fill(null) }));
  // Entries for a built-in activity recorded before the organization changed its list.
  for (const [key, row] of cells) if (!rows.some((r) => r.key === key)) rows.push({ key, name: nameOf(key), hidden: true, cells: row });
  return { days: n, tz, rows, notes: notes.reverse().map((x) => ({ ...x, activity: nameOf(x.activity) })) };
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
      .where(and(eq(residents.facilityId, h.id), gte(adlEntries.recordedAt, start), isNull(residents.dischargedOn)));
    out.set(h.id, rows.length);
  }
  return out;
}
