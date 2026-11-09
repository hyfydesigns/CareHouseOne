/**
 * The one plan, priced per home with any number of residents: a free trial, then an introductory
 * price for the first months, then the regular price. PayPal bills it as a quantity of homes and
 * runs the whole schedule itself (one billing cycle for each step), so nobody has to approve the
 * move to the regular price.
 */
export const TRIAL_DAYS = 30;
export const INTRO_PRICE_PER_HOME = 49;
export const INTRO_MONTHS = 3;
export const PRICE_PER_HOME = 99;

export type PriceStage = "trial" | "intro" | "regular";

export interface MonthlyBill {
  homes: number;
  stage: PriceStage;
  perHome: number;
  total: number;
}

const DAY = 86_400_000;

export function trialEndsAt(start: Date): Date {
  return new Date(start.getTime() + TRIAL_DAYS * DAY);
}

/** The first payment at the regular price: the trial, then the introductory months. */
export function introEndsAt(start: Date): Date {
  const d = trialEndsAt(start);
  d.setUTCMonth(d.getUTCMonth() + INTRO_MONTHS);
  return d;
}

/** Where a subscription that started at `start` is in the schedule at `at`. */
export function priceStage(start: Date, at = new Date()): PriceStage {
  if (at < trialEndsAt(start)) return "trial";
  return at < introEndsAt(start) ? "intro" : "regular";
}

export const perHomeAt = (stage: PriceStage) => (stage === "trial" ? 0 : stage === "intro" ? INTRO_PRICE_PER_HOME : PRICE_PER_HOME);

/** The monthly price for an organization with this many homes (never fewer than one). */
export function monthlyBill(homes: number, stage: PriceStage = "regular"): MonthlyBill {
  const n = Math.max(1, homes);
  const perHome = perHomeAt(stage);
  return { homes: n, stage, perHome, total: n * perHome };
}

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** "2 homes" */
export function describeBill(b: Pick<MonthlyBill, "homes">): string {
  return `${b.homes} home${b.homes === 1 ? "" : "s"}`;
}

/** "$49 per home for the first 3 months, then $99" */
export const PRICE_SUMMARY = `${usd(INTRO_PRICE_PER_HOME)} per home for the first ${INTRO_MONTHS} months, then ${usd(PRICE_PER_HOME)}`;
