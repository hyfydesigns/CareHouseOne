/**
 * The one plan, priced per home with any number of residents: a free trial, then an introductory
 * price for the first months, then the regular price. PayPal bills it as a quantity of homes and
 * runs the whole schedule itself, so nobody has to approve the move to the regular price. When
 * each payment happens is the billing calendar in billing-cycle.ts.
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
