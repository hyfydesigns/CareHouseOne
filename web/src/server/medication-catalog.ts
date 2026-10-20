import { asc, desc, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import { medicationCatalog, medicationOrders } from "@/db/schema";
import { ROUTES } from "./meds";

export interface MedSuggestion {
  name: string;
  strength: string;
  route: string | null;
  /** From the organization's own orders only. */
  purpose?: string;
  residents?: number;
}

const ROUTE_RULES: Array<[RegExp, (typeof ROUTES)[number]]> = [
  [/sublingual|buccal/i, "Under the tongue"],
  [/transdermal|patch/i, "Patch"],
  [/ophthalmic/i, "Eye drops"],
  [/otic/i, "Ear drops"],
  [/nasal/i, "Nasal"],
  [/inhal/i, "Inhaled"],
  [/rectal/i, "Rectal"],
  [/inject|subcutaneous|intramuscular|intravenous|pen|syringe/i, "Injection"],
  [/topical|cream|ointment|gel|lotion|shampoo|vaginal/i, "Topical"],
  [/oral|tab|cap|liquid|susp|soln|syrup|chew/i, "By mouth"],
];

/** RxTerms' route (for example "Oral Pill") as one of the app's routes, or null when unclear. */
export function mapRoute(route: string, doseForm = ""): string | null {
  const text = `${route} ${doseForm}`;
  return ROUTE_RULES.find(([re]) => re.test(text))?.[1] ?? null;
}

const FORM_WORDS: Array<[RegExp, string]> = [
  [/\bTabs?\b/gi, "tablet"],
  [/\bCaps?\b/gi, "capsule"],
  [/\bSoln\b|\bSol\b/gi, "solution"],
  [/\bSusp\b/gi, "suspension"],
  [/\bOint\b/gi, "ointment"],
  [/\bInj\b/gi, "injection"],
  [/\bER\b/g, "extended-release"],
  [/\bDR\b/g, "delayed-release"],
  [/\bODT\b/g, "orally disintegrating tablet"],
];

/** "10 mg" + "Tab" becomes "10 mg tablet". */
export function strengthLabel(strength: string, form: string): string {
  let f = form.trim();
  for (const [re, word] of FORM_WORDS) f = f.replace(re, word);
  return [strength.trim().replace(/\bMG\b/g, "mg").replace(/\bML\b/g, "mL"), f.toLowerCase()].filter(Boolean).join(" ").replace(/\s+/g, " ");
}

export interface CatalogRow {
  name: string;
  strength: string;
  route: string | null;
  synonyms: string | null;
  rxcui: string | null;
}

/**
 * Parses the main RxTerms file (RxTerms<version>.txt). Columns are read by their header names, so
 * column order changes don't matter. Suppressed and retired rows and packs are skipped, as NLM
 * advises; one row is kept per name + strength + route.
 */
export function parseRxTerms(text: string): CatalogRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const sep = lines[0].includes("|") ? "|" : "\t";
  const head = lines[0].split(sep).map((h) => h.trim().toUpperCase());
  const col = (name: string) => head.indexOf(name);
  const need = ["RXCUI", "TTY", "DISPLAY_NAME", "ROUTE", "NEW_DOSE_FORM", "STRENGTH", "SUPPRESS_FOR", "IS_RETIRED", "DISPLAY_NAME_SYNONYM"];
  const missing = need.filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Not an RxTerms file (missing ${missing.join(", ")})`);
  const seen = new Map<string, CatalogRow>();
  for (const line of lines.slice(1)) {
    const f = line.split(sep);
    const get = (name: string) => (f[col(name)] ?? "").trim();
    if (get("SUPPRESS_FOR") || get("IS_RETIRED")) continue;
    if (!["SCD", "SBD"].includes(get("TTY"))) continue;
    const name = get("DISPLAY_NAME").replace(/\s*\([^)]*\)\s*$/, "").trim();
    const strength = strengthLabel(get("STRENGTH"), get("NEW_DOSE_FORM"));
    if (!name || !strength) continue;
    const route = mapRoute(get("ROUTE"), get("NEW_DOSE_FORM"));
    const key = `${name.toLowerCase()}|${strength.toLowerCase()}|${route ?? ""}`;
    if (!seen.has(key)) seen.set(key, { name, strength, route, synonyms: get("DISPLAY_NAME_SYNONYM") || null, rxcui: get("RXCUI") || null });
  }
  return [...seen.values()];
}

/** Replaces the whole list with a new edition. Run as the database owner (scripts/rx-import.ts). */
export async function importCatalog(db: DB, rows: CatalogRow[], version: string): Promise<number> {
  await db.transaction(async (tx) => {
    await tx.delete(medicationCatalog);
    for (let i = 0; i < rows.length; i += 1000) {
      await tx.insert(medicationCatalog).values(rows.slice(i, i + 1000).map((r) => ({ ...r, version }))).onConflictDoNothing();
    }
  });
  return rows.length;
}

const like = (q: string) => q.trim().toLowerCase().replace(/[\\%_]/g, (c) => "\\" + c);

/**
 * Suggestions while typing a medication name: what this organization has ordered before (with
 * the strength, route and purpose it used), then the standard list. Runs inside a tenant, so
 * "history" only ever shows the caller's own organization.
 */
export async function searchMedications(tx: Tx, q: string): Promise<{ history: MedSuggestion[]; catalog: MedSuggestion[] }> {
  const term = like(q);
  if (term.length < 2) return { history: [], catalog: [] };
  const orders = await tx
    .select({ name: medicationOrders.name, strength: medicationOrders.strength, route: medicationOrders.route, purpose: medicationOrders.purpose, residentId: medicationOrders.residentId })
    .from(medicationOrders)
    .where(sql`lower(${medicationOrders.name}) like ${"%" + term + "%"} escape '\\'`)
    .orderBy(desc(medicationOrders.createdAt))
    .limit(200);
  const history = new Map<string, MedSuggestion & { who: Set<string> }>();
  for (const o of orders) {
    const key = `${o.name.toLowerCase()}|${o.strength.toLowerCase()}|${o.route}`;
    const h = history.get(key) ?? { name: o.name, strength: o.strength, route: o.route, purpose: o.purpose, who: new Set<string>() };
    h.who.add(o.residentId);
    history.set(key, h);
  }
  const startsFirst = (a: MedSuggestion, b: MedSuggestion) =>
    Number(!a.name.toLowerCase().startsWith(term)) - Number(!b.name.toLowerCase().startsWith(term)) ||
    a.name.localeCompare(b.name) ||
    a.strength.localeCompare(b.strength, undefined, { numeric: true });
  const mine = [...history.values()].map(({ who, ...h }) => ({ ...h, residents: who.size })).sort(startsFirst).slice(0, 8);

  const rows = await tx
    .select({ name: medicationCatalog.name, strength: medicationCatalog.strength, route: medicationCatalog.route })
    .from(medicationCatalog)
    .where(sql`lower(${medicationCatalog.name}) like ${term + "%"} escape '\\' or lower(coalesce(${medicationCatalog.synonyms}, '')) like ${"%" + term + "%"} escape '\\'`)
    .orderBy(asc(sql`length(${medicationCatalog.name})`), asc(medicationCatalog.name))
    .limit(60);
  const taken = new Set(mine.map((m) => `${m.name.toLowerCase()}|${m.strength.toLowerCase()}`));
  const catalog = rows
    .filter((r) => !taken.has(`${r.name.toLowerCase()}|${r.strength.toLowerCase()}`))
    .sort(startsFirst)
    .slice(0, 12);
  return { history: mine, catalog };
}

/** How many entries the standard list has (for the screen's "list not loaded" hint). */
export async function catalogSize(tx: Tx): Promise<number> {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(medicationCatalog);
  return r.n;
}

