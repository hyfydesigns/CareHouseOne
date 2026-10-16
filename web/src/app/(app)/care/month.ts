export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Resolves ?m=YYYY-MM against today's local date; future months fall back to the current one. */
export function monthFrom(param: string | undefined, today: string) {
  const [cy, cm] = today.split("-").map(Number);
  let [y, m] = /^\d{4}-\d{2}$/.test(param ?? "") ? param!.split("-").map(Number) : [cy, cm];
  if (m < 1 || m > 12 || y * 12 + m > cy * 12 + cm) [y, m] = [cy, cm];
  const key = (yy: number, mm: number) => `${yy}-${String(mm).padStart(2, "0")}`;
  const prev = m === 1 ? key(y - 1, 12) : key(y, m - 1);
  const next = m === 12 ? key(y + 1, 1) : key(y, m + 1);
  const isCurrent = y === cy && m === cm;
  return { year: y, month: m, label: `${MONTHS[m - 1]} ${y}`, prev, next: isCurrent ? null : next, isCurrent, prevLabel: MONTHS[(m + 10) % 12].slice(0, 3), nextLabel: MONTHS[m % 12].slice(0, 3) };
}
