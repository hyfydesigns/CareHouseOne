/**
 * The standard billing calendar every subscriber shares, in Central time:
 *   - a billing cycle runs from the 28th of one month to the 28th of the next;
 *   - the invoice goes out the day after the cycle ends (the 29th, or March 1st after February);
 *   - PayPal takes the payment automatically on the 5th;
 *   - a payment still missing on the 10th is late: a late fee is added and admin features pause.
 * Billing is in arrears: the payment on the 5th is for the cycle that just ended. The free trial
 * ends on any day, so the first invoice covers only the days from then to the 28th (prorated).
 * Calendar days are "YYYY-MM-DD" strings so nothing shifts with time zones.
 */
import { INTRO_MONTHS, INTRO_PRICE_PER_HOME, PRICE_PER_HOME, TRIAL_DAYS } from "./pricing";

export const CYCLE_DAY = 28;
export const DUE_DAY = 5;
export const LATE_DAY = 10;
export const LATE_FEE = 25;
export const BILLING_TIME_ZONE = "America/Chicago";

export type Day = string;
export type CycleStage = "first" | "intro" | "regular";

const DAY_MS = 86_400_000;

/** A calendar day; month and day may overflow (month 13 is January of the next year). */
export function ymd(y: number, m: number, d: number): Day {
  return new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
}
const parts = (d: Day) => d.split("-").map(Number) as [number, number, number];
const utc = (d: Day) => {
  const [y, m, dd] = parts(d);
  return Date.UTC(y, m - 1, dd);
};
export const addDays = (d: Day, n: number): Day => {
  const [y, m, dd] = parts(d);
  return ymd(y, m, dd + n);
};
export const daysBetween = (a: Day, b: Day) => Math.round((utc(b) - utc(a)) / DAY_MS);

/** The calendar day it is in Central time at this instant. */
export function dayIn(at: Date, timeZone = BILLING_TIME_ZONE): Day {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

/** The cycle end (a 28th) on or after this day. */
export function cycleEndOnOrAfter(d: Day): Day {
  const [y, m, dd] = parts(d);
  return dd <= CYCLE_DAY ? ymd(y, m, CYCLE_DAY) : ymd(y, m + 1, CYCLE_DAY);
}
/** The last cycle end strictly before this day: the cycle whose invoice is out by then. */
export function lastCycleEndBefore(d: Day): Day {
  const [y, m, dd] = parts(d);
  return dd > CYCLE_DAY ? ymd(y, m, CYCLE_DAY) : ymd(y, m - 1, CYCLE_DAY);
}
export const cycleStartOf = (end: Day) => {
  const [y, m] = parts(end);
  return ymd(y, m - 1, CYCLE_DAY);
};
export const nextCycleEnd = (end: Day) => {
  const [y, m] = parts(end);
  return ymd(y, m + 1, CYCLE_DAY);
};
export const invoiceDay = (end: Day) => addDays(end, 1);
export const dueDay = (end: Day) => {
  const [y, m] = parts(end);
  return ymd(y, m + 1, DUE_DAY);
};
export const lateDay = (end: Day) => {
  const [y, m] = parts(end);
  return ymd(y, m + 1, LATE_DAY);
};
const monthsBetween = (a: Day, b: Day) => {
  const [ay, am] = parts(a);
  const [by, bm] = parts(b);
  return (by - ay) * 12 + (bm - am);
};

/** When PayPal charges on a payment day: 14:00 UTC, the morning in Central time. */
export const chargeTime = (d: Day) => new Date(`${d}T14:00:00Z`);

/** One subscriber's place on the calendar, fixed when they sign up. */
export interface BillingSchedule {
  /** The first day that's paid for. */
  trialEndsOn: Day;
  /** The first cycle end; its invoice is the prorated one. */
  firstCycleEnd: Day;
  firstPerHomeCents: number;
  /** Whole cycles at the introductory price after the first one. */
  introCycles: number;
  /** The first payment day, when PayPal starts charging. */
  startsOn: Day;
}

export function scheduleFor(signedUpAt: Date): BillingSchedule {
  const trialEndsOn = addDays(dayIn(signedUpAt), TRIAL_DAYS);
  let end = cycleEndOnOrAfter(trialEndsOn);
  let introCycles = INTRO_MONTHS;
  // A trial that ends on the 28th starts a whole cycle: that's the first of the introductory months.
  if (end === trialEndsOn) {
    end = nextCycleEnd(end);
    introCycles -= 1;
  }
  const firstPerHomeCents = Math.round((INTRO_PRICE_PER_HOME * 100 * daysBetween(trialEndsOn, end)) / daysBetween(cycleStartOf(end), end));
  return { trialEndsOn, firstCycleEnd: end, firstPerHomeCents, introCycles, startsOn: dueDay(end) };
}

/** A billed cycle: its days (end is the 28th it runs to), the price per home, and the dates that follow. */
export interface Cycle {
  index: number;
  start: Day;
  end: Day;
  stage: CycleStage;
  perHomeCents: number;
  invoiceOn: Day;
  dueOn: Day;
  lateOn: Day;
}

/** The cycle that ends on `end` for this schedule, or null when it's before billing starts. */
export function cycleEnding(s: BillingSchedule, end: Day): Cycle | null {
  const index = monthsBetween(s.firstCycleEnd, end) + 1;
  if (index < 1) return null;
  const stage: CycleStage = index === 1 ? "first" : index <= 1 + s.introCycles ? "intro" : "regular";
  const perHomeCents = stage === "first" ? s.firstPerHomeCents : stage === "intro" ? INTRO_PRICE_PER_HOME * 100 : PRICE_PER_HOME * 100;
  return { index, start: index === 1 ? s.trialEndsOn : cycleStartOf(end), end, stage, perHomeCents, invoiceOn: invoiceDay(end), dueOn: dueDay(end), lateOn: lateDay(end) };
}

/** The cycle running on day `d` (or the first one, during the trial). */
export function cycleOn(s: BillingSchedule, d: Day): Cycle {
  const end = d < s.firstCycleEnd ? s.firstCycleEnd : cycleEndOnOrAfter(addDays(d, 1));
  return cycleEnding(s, end)!;
}

/** What to tell PayPal when the subscription is created: when to start charging and the first two price steps. */
export function paypalTerms(s: BillingSchedule) {
  return {
    start_time: chargeTime(s.startsOn).toISOString(),
    plan: {
      billing_cycles: [
        { sequence: 1, total_cycles: 1, pricing_scheme: { fixed_price: { value: (s.firstPerHomeCents / 100).toFixed(2), currency_code: "USD" } } },
        { sequence: 2, total_cycles: s.introCycles },
      ],
    },
  };
}

export const cents = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

/** "Dec 8" or "Dec 8, 2026" */
export function showDay(d: Day, year = false): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) });
}

/** The days a cycle covers, the way the calendar is described: "Nov 28 to Dec 28, 2026". */
export const showPeriod = (c: Pick<Cycle, "start" | "end">) => `${showDay(c.start)} to ${showDay(c.end, true)}`;
