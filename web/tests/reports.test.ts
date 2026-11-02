import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { administrations, incidents, vitals } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/time";
import { buildReport, reportCsv, reportRanges } from "@/server/reports";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const tz = "America/New_York";
const now = new Date("2026-11-10T18:00:00Z"); // 1 PM Eastern
const day = "2026-11-09";
const at = (time: string) => zonedToUtc(day, time, tz);
const q = () => ({ facilityId: s.facilities.cedarRidge, from: day, to: day });

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  const lena = c.residents.lena.id;
  const dose = (orderId: string, time: string, outcome: "given" | "refused", extra: { late?: boolean; reason?: string } = {}) => ({
    orgId: s.orgId, residentId: lena, orderId, scheduledFor: at(time), outcome, residentScanned: true, packageScanned: false, recordedBy: s.users.caregiver.id, recordedAt: at(time), ...extra,
  });
  await inOrg((tx) =>
    tx.insert(administrations).values([
      dose(c.orders.lisinopril, "08:00", "given"),
      dose(c.orders.omeprazole, "08:00", "refused", { reason: "Didn't want it" }),
      dose(c.orders.sertraline, "08:00", "given", { late: true }),
      // Sertraline at 8 PM was never recorded: missed.
    ]),
  );
  await inOrg((tx) =>
    tx.insert(vitals).values([
      { orgId: s.orgId, residentId: lena, systolic: 120, diastolic: 80, pulse: 70, weightTenthsLb: 2000, recordedBy: s.users.caregiver.id, recordedAt: at("09:00") },
      { orgId: s.orgId, residentId: lena, systolic: 170, diastolic: 96, pulse: 72, weightTenthsLb: 1890, flags: ["High blood pressure"], recordedBy: s.users.caregiver.id, recordedAt: at("19:00") },
    ]),
  );
  await inOrg((tx) =>
    tx.insert(incidents).values({ orgId: s.orgId, facilityId: s.facilities.cedarRidge, residentId: lena, type: "fall", severity: "serious", occurredAt: at("10:15"), description: "Fell in the hall", actionTaken: "Helped her up.", injury: true, reportedBy: s.users.caregiver.id }),
  );
});

const table = (r: Awaited<ReturnType<typeof buildReport>>, title: string) => r!.tables.find((t) => t.title === title)!;

describe("reports", () => {
  it("are for owners and admins, over a valid range of at most 93 days", async () => {
    expect(await inOrg((tx) => buildReport(tx, caregiver, "medication", q(), now))).toBeNull();
    expect(await inOrg((tx) => buildReport(tx, owner, "medication", { from: day, to: "2026-11-01" }, now))).toBeNull();
    expect(await inOrg((tx) => buildReport(tx, owner, "medication", { from: "2026-01-01", to: day }, now))).toBeNull();
    expect(reportRanges("2026-01-15")).toEqual({ thisMonth: { from: "2026-01-01", to: "2026-01-15" }, lastMonth: { from: "2025-12-01", to: "2025-12-31" }, last30: { from: "2025-12-17", to: "2026-01-15" } });
  });

  it("medication: counts given, late, refused and missed doses per resident and lists the exceptions", async () => {
    const r = await inOrg((tx) => buildReport(tx, owner, "medication", q(), now));
    const lena = table(r, "By resident").rows.find((x) => String(x[0]).startsWith("Lena"))!;
    // Resident, Home, Due, Given, Late, Refused, Held, Missed, On time, As-needed
    expect(lena.slice(2)).toEqual([4, 2, 1, 1, 0, 1, "25%", 0]);
    const what = table(r, "Missed, refused, held and late doses").rows.filter((x) => String(x[2]).startsWith("Lena")).map((x) => x[4]);
    expect(what).toEqual(expect.arrayContaining(["Refused: Didn't want it", "Given late", "Missed (not recorded)"]));
  });

  it("incidents and the resident summary pick up the day's records", async () => {
    const inc = await inOrg((tx) => buildReport(tx, owner, "incidents", q(), now));
    expect(inc!.tiles.find((t) => t.label === "serious")?.value).toBe(1);
    expect(table(inc, "All incidents").rows[0]).toEqual(expect.arrayContaining(["Fall", "Serious", "Yes", "Usually", "Open"]));
    const res = await inOrg((tx) => buildReport(tx, owner, "residents", q(), now));
    expect(res!.tiles.find((t) => t.label === "weight change of 5% or more")?.value).toBe(1);
    const lena = table(res, "Residents").rows.find((x) => String(x[0]).startsWith("Lena"))!;
    expect(lena.slice(2, 6)).toEqual([2, "145/88", 1, "-11 lb (-5.5%)"]);
    // Maple House sees none of it.
    const maple = await inOrg((tx) => buildReport(tx, owner, "incidents", { ...q(), facilityId: s.facilities.mapleHouse }, now));
    expect(maple!.tiles[0].value).toBe(0);
  });

  it("downloads as a spreadsheet, and staffing has its three tables", async () => {
    const r = await inOrg((tx) => buildReport(tx, owner, "incidents", q(), now));
    const csv = reportCsv(r!);
    expect(csv.split("\r\n")[0]).toBe('"Incidents report"');
    expect(csv).toContain('"Fall"');
    const staffing = await inOrg((tx) => buildReport(tx, owner, "staffing", q(), now));
    expect(staffing!.tables.map((t) => t.title)).toEqual(["Hours by person", "Hours by home", "Training expired or expiring in the next 30 days"]);
  });
});
