import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Tx } from "@/db/client";
import { adlEntries, administrations, appointments, facilities, incidents, medicationOrders, prnFollowups, progressNotes, residents, users, vitals, type Resident } from "@/db/schema";
import { canSeeFacility, canViewAudit, type Actor } from "@/lib/permissions";
import { addDays, daysInMonth, isDate, localClock, localDate, zonedToUtc } from "@/lib/time";
import { SUPPORT_LEVELS, type SupportLevel } from "./adl";
import { INCIDENT_TYPES, listIncidents, needsStateReport, SEVERITIES, type IncidentType } from "./incidents";
import { WINDOW_MINUTES } from "./meds";
import { csvCell, timesheet } from "./timesheets";
import { certName, trainingOverview } from "./training";

export const REPORTS = {
  medication: { title: "Medication", blurb: "Doses given, late, refused, held and missed; as-needed doses and their follow-ups." },
  incidents: { title: "Incidents", blurb: "Incidents by type, severity and resident, with the ones still open." },
  staffing: { title: "Staffing and hours", blurb: "Hours worked from the tablet sign-ins, and training that has expired or expires soon." },
  residents: { title: "Resident summary", blurb: "For each resident: vital signs, weight change, daily care, doses, incidents, appointments and notes." },
} as const;
export type ReportKind = keyof typeof REPORTS;
export const isReportKind = (k: unknown): k is ReportKind => typeof k === "string" && k in REPORTS;
export const MAX_REPORT_DAYS = 93;
export const canViewReports = (actor: Pick<Actor, "role">) => canViewAudit(actor);

/** This month so far, last month, and the last 30 days, in the first home's time zone. */
export function reportRanges(today: string) {
  const [y, m] = today.split("-").map(Number);
  const first = today.slice(0, 8) + "01";
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevFirst = `${prevY}-${String(prevM).padStart(2, "0")}-01`;
  return {
    thisMonth: { from: first, to: today },
    lastMonth: { from: prevFirst, to: `${prevFirst.slice(0, 8)}${String(daysInMonth(prevY, prevM)).padStart(2, "0")}` },
    last30: { from: addDays(today, -29), to: today },
  };
}

export type Cell = string | number | null;
export interface ReportTable {
  title: string;
  columns: string[];
  rows: Cell[][];
  empty: string;
  note?: string;
}
export interface Report {
  kind: ReportKind;
  title: string;
  from: string;
  to: string;
  homes: string;
  tiles: Array<{ label: string; value: string | number; tone?: "good" | "info" | "warn" | "crit" }>;
  tables: ReportTable[];
}

type Home = typeof facilities.$inferSelect;
interface Scope {
  homes: Home[];
  from: string;
  to: string;
  /** Each home's period as instants: its local midnight on `from` to midnight after `to`. */
  start: (h: Home) => Date;
  end: (h: Home) => Date;
  earliest: Date;
  latest: Date;
}

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—");

/**
 * One of the reports for the homes the person can see (or one home), from `from` to `to`
 * (inclusive, each home's local dates). Owners and admins only. The same report is shown on the
 * page, printed and downloaded, so all three always agree.
 */
export async function buildReport(tx: Tx, actor: Actor, kind: ReportKind, q: { facilityId?: string; from: string; to: string }, now: Date): Promise<Report | null> {
  if (!canViewReports(actor) || !isDate(q.from) || !isDate(q.to) || q.from > q.to || addDays(q.from, MAX_REPORT_DAYS) < q.to) return null;
  const homes = (await tx.select().from(facilities).orderBy(asc(facilities.name))).filter((h) => canSeeFacility(actor, h.id) && (!q.facilityId || h.id === q.facilityId));
  const start = (h: Home) => zonedToUtc(q.from, "00:00", h.timeZone);
  const end = (h: Home) => zonedToUtc(addDays(q.to, 1), "00:00", h.timeZone);
  const scope: Scope = {
    homes,
    from: q.from,
    to: q.to,
    start,
    end,
    earliest: new Date(Math.min(...homes.map((h) => start(h).getTime()), Date.now())),
    latest: new Date(Math.max(...homes.map((h) => end(h).getTime()), 0)),
  };
  const base = { kind, title: REPORTS[kind].title, from: q.from, to: q.to, homes: homes.length === 1 ? homes[0].name : "All homes" };
  if (!homes.length) return { ...base, tiles: [], tables: [] };
  const body =
    kind === "medication" ? await medicationReport(tx, scope, now)
    : kind === "incidents" ? await incidentReport(tx, actor, scope)
    : kind === "staffing" ? await staffingReport(tx, actor, scope, now)
    : await residentReport(tx, scope, now);
  return { ...base, ...body };
}

// ---------------------------------------------------------------- medication

interface MedStats {
  due: number;
  given: number;
  late: number;
  refused: number;
  held: number;
  missed: number;
  prn: number;
}
const noStats = (): MedStats => ({ due: 0, given: 0, late: 0, refused: 0, held: 0, missed: 0, prn: 0 });

/** Residents who lived at the homes at some point in the period. */
async function residentsIn(tx: Tx, s: Scope): Promise<Resident[]> {
  const rows = await tx.select().from(residents).where(inArray(residents.facilityId, s.homes.map((h) => h.id))).orderBy(asc(residents.lastName), asc(residents.firstName));
  return rows.filter((r) => r.status === "active" || !r.dischargedOn || r.dischargedOn >= s.from);
}

/**
 * Every scheduled dose in the period that is past (as on the monthly medication record: a dose
 * nobody recorded within the window counts as missed), plus as-needed doses, per resident.
 */
async function doseData(tx: Tx, s: Scope, rs: Resident[], now: Date) {
  const ids = rs.map((r) => r.id);
  if (!ids.length) return { perResident: new Map<string, MedStats>(), perStaff: new Map<string, MedStats>(), exceptions: [] as Cell[][], prn: [] as Cell[][] };
  const orders = await tx.select().from(medicationOrders).where(inArray(medicationOrders.residentId, ids));
  const doses = await tx
    .select({ d: administrations, by: users.name })
    .from(administrations)
    .leftJoin(users, eq(users.id, administrations.recordedBy))
    .where(and(inArray(administrations.residentId, ids), gte(administrations.recordedAt, new Date(s.earliest.getTime() - 86_400_000)), lt(administrations.recordedAt, new Date(s.latest.getTime() + 86_400_000))));
  const prnIds = doses.filter((x) => !x.d.scheduledFor).map((x) => x.d.id);
  const fups = prnIds.length ? await tx.select().from(prnFollowups).where(inArray(prnFollowups.administrationId, prnIds)) : [];
  const perResident = new Map<string, MedStats>();
  const perStaff = new Map<string, MedStats>();
  const exceptions: Array<{ at: Date; row: Cell[] }> = [];
  const prn: Array<{ at: Date; row: Cell[] }> = [];
  const staff = (name: string | null) => {
    const k = name ?? "Unknown";
    if (!perStaff.has(k)) perStaff.set(k, noStats());
    return perStaff.get(k)!;
  };
  for (const r of rs) {
    const h = s.homes.find((x) => x.id === r.facilityId)!;
    const tz = h.timeZone;
    const today = localDate(now, tz);
    const st = noStats();
    perResident.set(r.id, st);
    const who = `${r.firstName} ${r.lastName}`;
    for (const o of orders.filter((x) => x.residentId === r.id && x.type === "scheduled")) {
      const med = `${o.name} ${o.strength}`;
      for (let date = s.from; date <= s.to && date <= today; date = addDays(date, 1)) {
        const inEffect = o.startDate <= date && (!o.stopDate || date <= o.stopDate) && (o.status === "active" || (o.stoppedAt && date <= localDate(o.stoppedAt, tz)));
        if (!inEffect) continue;
        for (const time of o.times) {
          const at = zonedToUtc(date, time, tz);
          const hit = doses.find((x) => x.d.orderId === o.id && x.d.scheduledFor?.getTime() === at.getTime());
          if (!hit && now.getTime() <= at.getTime() + WINDOW_MINUTES * 60_000) continue; // not due yet, or due now
          st.due++;
          if (!hit) {
            st.missed++;
            exceptions.push({ at, row: [date, localClock(at, tz), who, med, "Missed (not recorded)", null] });
            continue;
          }
          const by = staff(hit.by);
          const what = hit.d.outcome;
          st[what]++;
          by[what]++;
          if (what === "given" && hit.d.late) {
            st.late++;
            by.late++;
          }
          if (what !== "given" || hit.d.late) {
            const label = what === "given" ? "Given late" : `${what === "refused" ? "Refused" : "Held"}${hit.d.reason ? `: ${hit.d.reason}` : ""}`;
            exceptions.push({ at, row: [date, localClock(at, tz), who, med, label, hit.by] });
          }
        }
      }
    }
    for (const x of doses.filter((x) => x.d.residentId === r.id && !x.d.scheduledFor && x.d.recordedAt >= s.start(h) && x.d.recordedAt < s.end(h))) {
      const o = orders.find((y) => y.id === x.d.orderId);
      st.prn++;
      staff(x.by).prn++;
      const f = fups.find((y) => y.administrationId === x.d.id);
      const result = f?.result ? { effective: "Effective", partly_effective: "Partly effective", not_effective: "Not effective" }[f.result] : f && f.dueAt > now ? "Not due yet" : "Not recorded";
      prn.push({ at: x.d.recordedAt, row: [localDate(x.d.recordedAt, tz), localClock(x.d.recordedAt, tz), who, o ? `${o.name} ${o.strength}` : "", x.d.reason, x.by, result] });
    }
  }
  const byTime = (a: { at: Date }, b: { at: Date }) => a.at.getTime() - b.at.getTime();
  return { perResident, perStaff, exceptions: exceptions.sort(byTime).map((x) => x.row), prn: prn.sort(byTime).map((x) => x.row) };
}

async function medicationReport(tx: Tx, s: Scope, now: Date): Promise<Pick<Report, "tiles" | "tables">> {
  const rs = await residentsIn(tx, s);
  const d = await doseData(tx, s, rs, now);
  const all = [...d.perResident.values()].reduce((t, x) => {
    for (const k of Object.keys(t) as Array<keyof MedStats>) t[k] += x[k];
    return t;
  }, noStats());
  const followupsMissing = d.prn.filter((r) => r[6] === "Not recorded").length;
  const home = (r: Resident) => s.homes.find((h) => h.id === r.facilityId)?.name ?? "";
  return {
    tiles: [
      { label: "scheduled doses due", value: all.due, tone: "info" },
      { label: "given on time", value: pct(all.given - all.late, all.due), tone: all.due && all.given - all.late === all.due ? "good" : undefined },
      { label: "given late", value: all.late, tone: all.late ? "warn" : undefined },
      { label: "refused", value: all.refused },
      { label: "held", value: all.held },
      { label: "missed (not recorded)", value: all.missed, tone: all.missed ? "crit" : "good" },
      { label: "as-needed doses", value: all.prn },
      { label: "as-needed follow-ups not recorded", value: followupsMissing, tone: followupsMissing ? "warn" : undefined },
    ],
    tables: [
      {
        title: "By resident",
        columns: ["Resident", "Home", "Due", "Given", "Late", "Refused", "Held", "Missed", "On time", "As-needed"],
        rows: rs.map((r) => {
          const x = d.perResident.get(r.id)!;
          return [`${r.firstName} ${r.lastName}`, home(r), x.due, x.given, x.late, x.refused, x.held, x.missed, pct(x.given - x.late, x.due), x.prn];
        }),
        empty: "No residents in this period.",
      },
      {
        title: "By staff member",
        columns: ["Name", "Given", "Given late", "Refused", "Held", "As-needed given"],
        rows: [...d.perStaff.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, x]) => [name, x.given, x.late, x.refused, x.held, x.prn]),
        empty: "No doses recorded in this period.",
        note: "Missed doses aren't counted against anyone: nobody recorded them.",
      },
      { title: "Missed, refused, held and late doses", columns: ["Date", "Time", "Resident", "Medication", "What happened", "Recorded by"], rows: d.exceptions, empty: "None. Every dose was given on time." },
      { title: "As-needed doses", columns: ["Date", "Time", "Resident", "Medication", "Reason", "Given by", "Follow-up"], rows: d.prn, empty: "No as-needed doses in this period." },
    ],
  };
}

// ---------------------------------------------------------------- incidents

async function incidentReport(tx: Tx, actor: Actor, s: Scope): Promise<Pick<Report, "tiles" | "tables">> {
  const rows = (await listIncidents(tx, actor, { from: s.earliest, to: s.latest }))
    .filter((r) => {
      const h = s.homes.find((x) => x.id === r.i.facilityId);
      return h && r.i.occurredAt >= s.start(h) && r.i.occurredAt < s.end(h);
    })
    .sort((a, b) => a.i.occurredAt.getTime() - b.i.occurredAt.getTime());
  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const type = (t: string) => INCIDENT_TYPES[t as IncidentType] ?? t;
  const byType = [...new Set(rows.map((r) => r.i.type))].map((t) => {
    const of = rows.filter((r) => r.i.type === t);
    return [type(t), of.length, of.filter((r) => r.i.injury).length, of.filter((r) => r.i.severity === "serious").length] as Cell[];
  });
  const byResident = [...new Set(rows.map((r) => r.resident ?? ""))].map((name) => {
    const of = rows.filter((r) => (r.resident ?? "") === name);
    return [name || "No resident involved", of[0].home, of.length, of.filter((r) => r.i.injury).length] as Cell[];
  });
  const open = count((r) => r.open);
  return {
    tiles: [
      { label: "incidents", value: rows.length, tone: "info" },
      { label: "with an injury", value: count((r) => r.i.injury), tone: count((r) => r.i.injury) ? "warn" : undefined },
      { label: "serious", value: count((r) => r.i.severity === "serious"), tone: count((r) => r.i.severity === "serious") ? "crit" : undefined },
      { label: "usually reported to the state", value: count((r) => needsStateReport(r.i)) },
      { label: "still open", value: open, tone: open ? "warn" : "good" },
    ],
    tables: [
      { title: "By type", columns: ["Type", "Incidents", "With injury", "Serious"], rows: byType.sort((a, b) => Number(b[1]) - Number(a[1])), empty: "No incidents in this period." },
      { title: "By resident", columns: ["Resident", "Home", "Incidents", "With injury"], rows: byResident.sort((a, b) => Number(b[2]) - Number(a[2])), empty: "No incidents in this period." },
      {
        title: "All incidents",
        columns: ["Date", "Time", "Home", "Resident", "Type", "Severity", "Injury", "State report", "Status", "Reported by"],
        rows: rows.map((r) => [localDate(r.i.occurredAt, r.tz), localClock(r.i.occurredAt, r.tz), r.home, r.resident ?? "—", type(r.i.type), SEVERITIES[r.i.severity as keyof typeof SEVERITIES] ?? r.i.severity, r.i.injury ? "Yes" : "No", needsStateReport(r.i) ? "Usually" : "", r.open ? "Open" : "Closed", r.by]),
        empty: "No incidents in this period.",
      },
    ],
  };
}

// ---------------------------------------------------------------- staffing

async function staffingReport(tx: Tx, actor: Actor, s: Scope, now: Date): Promise<Pick<Report, "tiles" | "tables">> {
  const homeIds = new Set(s.homes.map((h) => h.id));
  const homeNames = new Set(s.homes.map((h) => h.name));
  const sheet = await timesheet(tx, actor, { facilityId: s.homes.length === 1 ? s.homes[0].id : undefined, from: s.from, to: s.to }, now);
  const shifts = (sheet?.shifts ?? []).filter((x) => homeNames.has(x.home));
  const people = new Map<string, { name: string; shifts: number; hours: number; problems: number }>();
  for (const x of shifts) {
    const p = people.get(x.userId) ?? { name: x.name, shifts: 0, hours: 0, problems: 0 };
    p.shifts++;
    p.hours = Math.round((p.hours + (x.hours ?? 0)) * 100) / 100;
    if (x.status === "no_sign_out") p.problems++;
    people.set(x.userId, p);
  }
  const byHome = s.homes
    .filter((h) => homeIds.has(h.id))
    .map((h) => {
      const of = shifts.filter((x) => x.home === h.name);
      return [h.name, of.length, Math.round(of.reduce((n, x) => n + (x.hours ?? 0), 0) * 100) / 100, new Set(of.map((x) => x.userId)).size] as Cell[];
    });
  const today = localDate(now, s.homes[0].timeZone);
  const training = (await trainingOverview(tx, today)).flatMap((p) =>
    p.certs.filter((c) => c.status === "expired" || c.status === "expiring").map((c) => [p.name, certName(c), c.expiresOn, c.status === "expired" ? "Expired" : "Expires soon"] as Cell[]),
  );
  const hours = Math.round([...people.values()].reduce((n, p) => n + p.hours, 0) * 100) / 100;
  const problems = shifts.filter((x) => x.status === "no_sign_out").length;
  return {
    tiles: [
      { label: "staff who worked", value: people.size, tone: "info" },
      { label: "shifts", value: shifts.length },
      { label: "hours", value: hours.toFixed(2) },
      { label: "shifts without a sign-out", value: problems, tone: problems ? "warn" : undefined },
      { label: "training expired or expiring", value: training.length, tone: training.some((t) => t[3] === "Expired") ? "crit" : training.length ? "warn" : "good" },
    ],
    tables: [
      {
        title: "Hours by person",
        columns: ["Name", "Shifts", "Hours", "Without a sign-out"],
        rows: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)).map((p) => [p.name, p.shifts, p.hours.toFixed(2), p.problems || ""]),
        empty: "No shifts in this period.",
        note: problems ? "Shifts without a sign-out aren't counted in the hours." : undefined,
      },
      { title: "Hours by home", columns: ["Home", "Shifts", "Hours", "People"], rows: byHome, empty: "No homes." },
      { title: "Training expired or expiring in the next 30 days", columns: ["Name", "Training", "Expires", "Status"], rows: training, empty: "All training on file is current.", note: "Training covers all staff, whichever home they work at." },
    ],
  };
}

// ---------------------------------------------------------------- residents

async function residentReport(tx: Tx, s: Scope, now: Date): Promise<Pick<Report, "tiles" | "tables">> {
  const rs = await residentsIn(tx, s);
  const ids = rs.map((r) => r.id);
  if (!ids.length) return { tiles: [{ label: "residents", value: 0 }], tables: [] };
  const window = (col: AnyPgColumn) => and(gte(col, s.earliest), lt(col, s.latest));
  const vs = await tx.select().from(vitals).where(and(inArray(vitals.residentId, ids), window(vitals.recordedAt))).orderBy(asc(vitals.recordedAt));
  const adl = await tx.select().from(adlEntries).where(and(inArray(adlEntries.residentId, ids), window(adlEntries.recordedAt)));
  const notes = await tx.select({ residentId: progressNotes.residentId, at: progressNotes.recordedAt }).from(progressNotes).where(and(inArray(progressNotes.residentId, ids), window(progressNotes.recordedAt)));
  const appts = await tx.select().from(appointments).where(and(inArray(appointments.residentId, ids), window(appointments.scheduledAt)));
  const doses = await doseData(tx, s, rs, now);
  const incidentCounts = await incidentCountByResident(tx, s, rs);
  let flagged = 0;
  let weightAlerts = 0;
  let refusals = 0;
  let readings = 0;
  const rows = rs.map((r) => {
    const h = s.homes.find((x) => x.id === r.facilityId)!;
    const inside = (at: Date) => at >= s.start(h) && at < s.end(h);
    const v = vs.filter((x) => x.residentId === r.id && inside(x.recordedAt));
    const avg = (f: (x: (typeof v)[number]) => number) => Math.round(v.reduce((n, x) => n + f(x), 0) / v.length);
    const weights = v.filter((x) => x.weightTenthsLb != null);
    let weight: string | null = null;
    if (weights.length >= 2) {
      const first = weights[0].weightTenthsLb! / 10;
      const last = weights[weights.length - 1].weightTenthsLb! / 10;
      const change = Math.round((last - first) * 10) / 10;
      const p = Math.round((change / first) * 1000) / 10;
      if (Math.abs(p) >= 5) weightAlerts++;
      weight = `${change > 0 ? "+" : ""}${change} lb (${p > 0 ? "+" : ""}${p}%)`;
    }
    const care = adl.filter((x) => x.residentId === r.id && inside(x.recordedAt));
    const counts = new Map<string, number>();
    for (const x of care) if (x.support !== "refused" && x.support !== "not_needed") counts.set(x.support, (counts.get(x.support) ?? 0) + 1);
    const usual = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const refused = care.filter((x) => x.support === "refused").length;
    const ap = appts.filter((x) => x.residentId === r.id && inside(x.scheduledAt));
    const apLabel = ap.length ? [["done", "done"], ["missed", "missed"], ["cancelled", "cancelled"], ["scheduled", "scheduled"]].map(([k, l]) => [ap.filter((x) => x.status === k).length, l] as const).filter(([n]) => n).map(([n, l]) => `${n} ${l}`).join(", ") : "";
    const md = doses.perResident.get(r.id)!;
    const flaggedHere = v.filter((x) => x.flags.length).length;
    flagged += flaggedHere;
    refusals += refused;
    readings += v.length;
    return [
      `${r.firstName} ${r.lastName}${r.status === "discharged" ? " (discharged)" : ""}`,
      h.name,
      v.length,
      v.length ? `${avg((x) => x.systolic)}/${avg((x) => x.diastolic)}` : "—",
      flaggedHere,
      weight ?? "—",
      care.length,
      usual ? SUPPORT_LEVELS[usual as SupportLevel]?.label ?? usual : "—",
      refused,
      md.given,
      md.missed,
      incidentCounts.get(r.id) ?? 0,
      apLabel,
      notes.filter((x) => x.residentId === r.id && inside(x.at)).length,
    ] as Cell[];
  });
  return {
    tiles: [
      { label: "residents", value: rs.length, tone: "info" },
      { label: "vital sign readings", value: readings },
      { label: "readings out of range", value: flagged, tone: flagged ? "warn" : undefined },
      { label: "weight change of 5% or more", value: weightAlerts, tone: weightAlerts ? "crit" : "good" },
      { label: "daily care refusals", value: refusals, tone: refusals ? "warn" : undefined },
    ],
    tables: [
      {
        title: "Residents",
        columns: ["Resident", "Home", "Vital signs", "Average BP", "Out of range", "Weight change", "Daily care records", "Usual help", "Care refused", "Doses given", "Doses missed", "Incidents", "Appointments", "Notes"],
        rows,
        empty: "No residents in this period.",
        note: "Weight change compares the first and last weights recorded in the period. A change of 5% or more in a month is worth raising with the resident's doctor.",
      },
    ],
  };
}

async function incidentCountByResident(tx: Tx, s: Scope, rs: Resident[]): Promise<Map<string, number>> {
  const rows = await tx
    .select({ residentId: incidents.residentId, facilityId: incidents.facilityId, at: incidents.occurredAt })
    .from(incidents)
    .where(and(inArray(incidents.residentId, rs.map((r) => r.id)), gte(incidents.occurredAt, s.earliest), lt(incidents.occurredAt, s.latest)));
  const m = new Map<string, number>();
  for (const r of rows) {
    const h = s.homes.find((x) => x.id === r.facilityId);
    if (!h || !r.residentId || r.at < s.start(h) || r.at >= s.end(h)) continue;
    m.set(r.residentId, (m.get(r.residentId) ?? 0) + 1);
  }
  return m;
}

// ---------------------------------------------------------------- month end

/** Residents who lived at a home at some point in a month, for the month-end records. */
export async function residentsForMonth(tx: Tx, actor: Actor, facilityId: string, year: number, month: number): Promise<Resident[]> {
  if (!canSeeFacility(actor, facilityId)) return [];
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth(year, month)).padStart(2, "0")}`;
  const rows = await tx.select().from(residents).where(eq(residents.facilityId, facilityId)).orderBy(asc(residents.lastName), asc(residents.firstName));
  return rows.filter((r) => (r.status === "active" || !r.dischargedOn || r.dischargedOn >= first) && (!r.admittedOn || r.admittedOn <= last));
}

// ---------------------------------------------------------------- spreadsheet

/** The spreadsheet version: a heading, then each table with its title. */
export function reportCsv(r: Report): string {
  const line = (cells: Cell[]) => cells.map(csvCell).join(",");
  const out = [line([`${r.title} report`]), line([r.homes, `${r.from} to ${r.to}`]), ""];
  if (r.tiles.length) {
    out.push(line(["Summary"]));
    for (const t of r.tiles) out.push(line([t.label, t.value]));
    out.push("");
  }
  for (const t of r.tables) {
    out.push(line([t.title]));
    out.push(line(t.columns));
    for (const row of t.rows) out.push(line(row));
    if (!t.rows.length) out.push(line([t.empty]));
    out.push("");
  }
  return out.join("\r\n") + "\r\n";
}
