import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { facilities, shiftPunches, users, type Role } from "@/db/schema";
import { canViewAudit, type Actor } from "@/lib/permissions";
import { addDays, isDate, localClock, localDate, zonedToUtc } from "@/lib/time";

/** A sign-in with no sign-out after this long is shown as missing a sign-out, not as on shift. */
export const OPEN_SHIFT_HOURS = 16;
export const MAX_RANGE_DAYS = 93;

export interface TimesheetShift {
  id: string;
  userId: string;
  name: string;
  role: Role;
  home: string;
  date: string;
  /** For sorting; the times below are for display ("7:00 AM"). */
  startedAt: Date;
  signedIn: string;
  signedOut: string | null;
  hours: number | null;
  status: "complete" | "on_shift" | "no_sign_out";
}

export interface Timesheet {
  from: string;
  to: string;
  shifts: TimesheetShift[];
  people: Array<{ userId: string; name: string; hours: number; shifts: number; problems: number }>;
}

export const canViewTimesheets = (actor: Pick<Actor, "role">) => canViewAudit(actor);

/**
 * Every shift started between `from` and `to` (inclusive, each home's local dates), from the
 * tablet sign-ins and sign-outs, with hours and per-person totals. Owners and admins only.
 */
export async function timesheet(tx: Tx, actor: Actor, q: { facilityId?: string; from: string; to: string }, now: Date): Promise<Timesheet | null> {
  if (!canViewTimesheets(actor) || !isDate(q.from) || !isDate(q.to) || q.from > q.to || addDays(q.from, MAX_RANGE_DAYS) < q.to) return null;
  const homes = (await tx.select().from(facilities).orderBy(asc(facilities.name))).filter((h) => !q.facilityId || h.id === q.facilityId);
  if (!homes.length) return { from: q.from, to: q.to, shifts: [], people: [] };
  const shifts: TimesheetShift[] = [];
  for (const h of homes) {
    const start = zonedToUtc(q.from, "00:00", h.timeZone);
    const end = zonedToUtc(addDays(q.to, 1), "00:00", h.timeZone);
    const rows = await tx
      .select({ p: shiftPunches, name: users.name, role: users.role })
      .from(shiftPunches)
      .innerJoin(users, eq(users.id, shiftPunches.userId))
      .where(and(inArray(shiftPunches.facilityId, [h.id]), gte(shiftPunches.signedInAt, start), lt(shiftPunches.signedInAt, end)))
      .orderBy(asc(shiftPunches.signedInAt));
    for (const { p, name, role } of rows) {
      const open = !p.signedOutAt;
      const stale = open && now.getTime() - p.signedInAt.getTime() > OPEN_SHIFT_HOURS * 3_600_000;
      shifts.push({
        id: p.id,
        userId: p.userId,
        name,
        role,
        home: h.name,
        date: localDate(p.signedInAt, h.timeZone),
        startedAt: p.signedInAt,
        signedIn: localClock(p.signedInAt, h.timeZone),
        signedOut: p.signedOutAt ? `${localClock(p.signedOutAt, h.timeZone)}${localDate(p.signedOutAt, h.timeZone) !== localDate(p.signedInAt, h.timeZone) ? " (+1 day)" : ""}` : null,
        hours: p.signedOutAt ? Math.round(((p.signedOutAt.getTime() - p.signedInAt.getTime()) / 3_600_000) * 100) / 100 : null,
        status: open ? (stale ? "no_sign_out" : "on_shift") : "complete",
      });
    }
  }
  shifts.sort((a, b) => a.name.localeCompare(b.name) || a.startedAt.getTime() - b.startedAt.getTime());
  const byPerson = new Map<string, Timesheet["people"][number]>();
  for (const s of shifts) {
    const p = byPerson.get(s.userId) ?? { userId: s.userId, name: s.name, hours: 0, shifts: 0, problems: 0 };
    p.shifts++;
    p.hours = Math.round((p.hours + (s.hours ?? 0)) * 100) / 100;
    if (s.status === "no_sign_out") p.problems++;
    byPerson.set(s.userId, p);
  }
  return { from: q.from, to: q.to, shifts, people: [...byPerson.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

const csvCell = (v: string | number | null) => {
  const s = v == null ? "" : String(v);
  // Quote everything; neutralise spreadsheet formulas in names.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/** The spreadsheet version, one row per shift, for payroll. */
export function timesheetCsv(t: Timesheet): string {
  const status = { complete: "", on_shift: "Still on shift", no_sign_out: "No sign-out" } as const;
  const lines = [["Name", "Home", "Date", "Signed in", "Signed out", "Hours", "Note"].map(csvCell).join(",")];
  for (const s of t.shifts) lines.push([s.name, s.home, s.date, s.signedIn, s.signedOut, s.hours, status[s.status]].map(csvCell).join(","));
  lines.push("");
  lines.push(["Name", "Shifts", "Total hours", "Shifts missing a sign-out"].map(csvCell).join(","));
  for (const p of t.people) lines.push([p.name, p.shifts, p.hours, p.problems].map(csvCell).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** Default range: the current week, Monday to Sunday, in the first home's time zone. */
export function thisWeek(now: Date, tz: string): { from: string; to: string } {
  const today = localDate(now, tz);
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  const from = addDays(today, -((dow + 6) % 7));
  return { from, to: addDays(from, 6) };
}
