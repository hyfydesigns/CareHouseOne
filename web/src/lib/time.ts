/** Time-zone helpers. Doses are scheduled in each home's local time and stored in UTC. */

function parts(d: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, min: +p.minute, s: +p.second };
}

function offsetMinutes(d: Date, tz: string): number {
  const p = parts(d, tz);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return Math.round((asUtc - d.getTime()) / 60_000);
}

/** "2026-10-16" + "08:00" in America/New_York → the UTC instant. Handles daylight saving changes. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const guess = new Date(`${date}T${time}:00Z`);
  let t = guess.getTime() - offsetMinutes(guess, tz) * 60_000;
  t = guess.getTime() - offsetMinutes(new Date(t), tz) * 60_000;
  return new Date(t);
}

/** The local calendar date ("YYYY-MM-DD") of an instant in a time zone. */
export function localDate(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

/** Local "HH:MM" of an instant. */
export function localTime(d: Date, tz: string): string {
  const p = parts(d, tz);
  return `${String(p.h).padStart(2, "0")}:${String(p.min).padStart(2, "0")}`;
}

/**
 * For display only: "08:00" becomes "8:00 AM", "20:30" becomes "8:30 PM". Times are stored and
 * compared as 24-hour "HH:MM"; staff see AM/PM.
 */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** For display: an instant as "8:00 AM" in the home's time zone. */
export function localClock(d: Date, tz: string): string {
  return clock(localTime(d, tz));
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
