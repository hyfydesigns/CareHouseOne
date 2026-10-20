import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { catalogSize, mapRoute, parseRxTerms, searchMedications, strengthLabel } from "@/server/medication-catalog";
import { seedCare, seedDemo, type Seeded } from "@/server/seed";

let db: DB;
let s: Seeded;
let other: Seeded;

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  await seedCare(db, s);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
});

const HEAD = "RXCUI|GENERIC_RXCUI|TTY|FULL_NAME|RXN_DOSE_FORM|FULL_GENERIC_NAME|BRAND_NAME|DISPLAY_NAME|ROUTE|NEW_DOSE_FORM|STRENGTH|SUPPRESS_FOR|DISPLAY_NAME_SYNONYM|IS_RETIRED|SXDG_RXCUI|SXDG_TTY|SXDG_NAME|PSN";
const row = (o: Record<string, string>) =>
  HEAD.split("|")
    .map((h) => o[h] ?? "")
    .join("|");

describe("loading RxTerms", () => {
  const file = [
    HEAD,
    row({ RXCUI: "314076", TTY: "SCD", DISPLAY_NAME: "Lisinopril (Oral Pill)", ROUTE: "Oral Pill", NEW_DOSE_FORM: "Tab", STRENGTH: "10 mg" }),
    row({ RXCUI: "206765", TTY: "SBD", DISPLAY_NAME: "Lisinopril (Oral Pill)", ROUTE: "Oral Pill", NEW_DOSE_FORM: "Tab", STRENGTH: "10 mg" }),
    row({ RXCUI: "197770", TTY: "SCD", DISPLAY_NAME: "Hydrochlorothiazide (Oral Pill)", ROUTE: "Oral Pill", NEW_DOSE_FORM: "Tab", STRENGTH: "25 mg", DISPLAY_NAME_SYNONYM: "HCTZ" }),
    row({ RXCUI: "1", TTY: "SCD", DISPLAY_NAME: "Old drug (Oral Pill)", ROUTE: "Oral Pill", NEW_DOSE_FORM: "Tab", STRENGTH: "5 mg", IS_RETIRED: "TRUE" }),
    row({ RXCUI: "2", TTY: "SCD", DISPLAY_NAME: "Long/Combo/Thing (Topical)", ROUTE: "Topical", NEW_DOSE_FORM: "Oint", STRENGTH: "1%", SUPPRESS_FOR: "Long generic name" }),
    row({ RXCUI: "3", TTY: "GPCK", DISPLAY_NAME: "prednisoLONE (Pack)", ROUTE: "Pack", NEW_DOSE_FORM: "Pack", STRENGTH: "mixed" }),
    row({ RXCUI: "4", TTY: "SCD", DISPLAY_NAME: "Albuterol (Inhalant)", ROUTE: "Inhalant", NEW_DOSE_FORM: "Inhaler", STRENGTH: "90 mcg/actuat" }),
  ].join("\n");

  it("keeps usable rows once each, skips retired, suppressed and pack rows, and maps routes", () => {
    const rows = parseRxTerms(file);
    expect(rows.map((r) => `${r.name} | ${r.strength} | ${r.route}`)).toEqual([
      "Lisinopril | 10 mg tablet | By mouth",
      "Hydrochlorothiazide | 25 mg tablet | By mouth",
      "Albuterol | 90 mcg/actuat inhaler | Inhaled",
    ]);
    expect(rows[1].synonyms).toBe("HCTZ");
  });

  it("refuses a file that isn't RxTerms", () => {
    expect(() => parseRxTerms("code|description\nA00|Cholera")).toThrow(/Not an RxTerms file/);
  });

  it("maps routes and words sensibly", () => {
    expect(mapRoute("Ophthalmic", "Soln")).toBe("Eye drops");
    expect(mapRoute("Transdermal", "Patch")).toBe("Patch");
    expect(mapRoute("Injectable", "Pen")).toBe("Injection");
    expect(mapRoute("Something", "Odd")).toBeNull();
    // Real RxTerms routes that the first version got wrong or missed.
    expect(mapRoute("Oral Suspension Tablet", "Tab")).toBe("By mouth");
    expect(mapRoute("Oral Liquid", "Sol")).toBe("By mouth");
    expect(mapRoute("Oral Disintegrating", "ODT")).toBe("By mouth");
    expect(mapRoute("Buccal", "Film")).toBe("By mouth");
    expect(mapRoute("Sublingual", "Tab")).toBe("Under the tongue");
    expect(mapRoute("Pack", "Pack")).toBeNull();
    expect(mapRoute("", "Prefilled Syringe")).toBe("Injection");
    expect(strengthLabel("500 MG", "ER Tab")).toBe("500 mg extended-release tablet");
  });
});

describe("medication suggestions", () => {
  const search = (q: string, orgId = s.orgId) => withTenant(db, orgId, (tx) => searchMedications(tx, q));

  it("has the starter list in local and test databases", async () => {
    expect(await withTenant(db, s.orgId, (tx) => catalogSize(tx))).toBeGreaterThan(100);
  });

  it("shows this organization's own orders first, with strength, route and purpose", async () => {
    const r = await search("lisin");
    expect(r.history[0]).toMatchObject({ name: "Lisinopril", strength: "10 mg tablet", route: "By mouth", purpose: "Blood pressure", residents: 1 });
    // The standard list follows, without repeating what's already in history.
    expect(r.catalog.length).toBeGreaterThan(2);
    expect(r.catalog.every((c) => c.name === "Lisinopril")).toBe(true);
    expect(r.catalog.some((c) => c.strength === "10 mg tablet")).toBe(false);
  });

  it("never shows another organization's orders", async () => {
    const r = await search("lisin", other.orgId);
    expect(r.history).toEqual([]);
    expect(r.catalog.some((c) => c.strength === "10 mg tablet")).toBe(true);
  });

  it("finds by abbreviation and puts names that start with the text first", async () => {
    expect((await search("hctz")).catalog[0]?.name).toBe("Hydrochlorothiazide");
    const met = await search("met");
    const names = [...met.history, ...met.catalog].map((m) => m.name.toLowerCase());
    expect(names[0].startsWith("met")).toBe(true);
  });

  it("ignores very short text and treats wildcards as plain text", async () => {
    expect(await search("l")).toEqual({ history: [], catalog: [] });
    expect(await search("%%")).toEqual({ history: [], catalog: [] });
    expect(await search("__")).toEqual({ history: [], catalog: [] });
  });
});
