/**
 * The one plan: a flat price per home that includes up to 8 residents, plus a charge for each
 * resident over 8 in a home. PayPal bills it as a quantity of $1 units, so the subscription
 * quantity is the monthly total in dollars.
 */
export const PRICE_PER_HOME = 149;
export const INCLUDED_RESIDENTS = 8;
export const PRICE_PER_EXTRA_RESIDENT = 15;

export interface MonthlyBill {
  homes: number;
  extraResidents: number;
  total: number;
}

/** The monthly price for an organization, from each home's count of active residents. */
export function monthlyBill(residentsPerHome: number[]): MonthlyBill {
  const homes = Math.max(1, residentsPerHome.length);
  const extraResidents = residentsPerHome.reduce((sum, n) => sum + Math.max(0, n - INCLUDED_RESIDENTS), 0);
  return { homes, extraResidents, total: homes * PRICE_PER_HOME + extraResidents * PRICE_PER_EXTRA_RESIDENT };
}

export const usd = (n: number) => `$${n.toLocaleString("en-US")}`;

/** "2 homes, 3 extra residents" */
export function describeBill(b: MonthlyBill): string {
  const homes = `${b.homes} home${b.homes === 1 ? "" : "s"}`;
  return b.extraResidents ? `${homes} and ${b.extraResidents} extra resident${b.extraResidents === 1 ? "" : "s"}` : homes;
}
