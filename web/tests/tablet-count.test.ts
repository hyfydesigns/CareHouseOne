import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, medicationOrders } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/time";
import { adjustCount, createOrder, isCountable, recordPrnDose, recordScheduledDose, runningLow, supplyOf } from "@/server/meds";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

const TZ = "America/New_York";
const DAY = "2026-10-20";
const at = (time: string) => zonedToUtc(DAY, time, TZ);

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let medCaregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const orderRow = async (id: string) => (await db.select().from(medicationOrders).where(eq(medicationOrders.id, id)))[0];

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  const both = [s.facilities.cedarRidge, s.facilities.mapleHouse];
  owner = { id: s.users.owner.id, role: "owner", facilityIds: both };
  medCaregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: both };
});

const newOrder = (over: Record<string, unknown>) =>
  inOrg((tx) =>
    createOrder(
      tx,
      owner,
      s.orgId,
      c.residents.ben.id,
      { name: "Sertraline", strength: "50 mg tablet", route: "By mouth", purpose: "Mood", type: "scheduled", times: ["08:00", "20:00"], startDate: DAY, ...over },
      at("07:00"),
    ),
  );

describe("tablet counts", () => {
  it("knows which strengths are countable", () => {
    expect(["50 mg tablet", "10 mg Tab", "100 mg capsule", "1 caplet"].every(isCountable)).toBe(true);
    expect(["5 mg/mL solution", "1% cream", "90 mcg/actuation inhaler"].some(isCountable)).toBe(false);
  });

  let sertraline: string;

  it("stores the count for tablets and works out the days left", async () => {
    const r = await newOrder({ countOnHand: "30", perDose: "1" });
    expect(r.ok).toBe(true);
    sertraline = r.ok ? r.data!.id : "";
    const o = await orderRow(sertraline);
    expect(o).toMatchObject({ countTenths: 300, doseTenths: 10 });
    expect(supplyOf(o)).toEqual({ count: 30, perDose: 1, daysLeft: 15, low: false });
  });

  it("ignores a count for things that aren't tablets, and allows half tablets only", async () => {
    const liquid = await newOrder({ name: "Risperidone", strength: "1 mg/mL solution", countOnHand: "30" });
    expect(liquid.ok).toBe(true);
    expect((await orderRow(liquid.ok ? liquid.data!.id : "")).countTenths).toBeNull();
    const third = await newOrder({ name: "Buspirone", strength: "10 mg tablet", countOnHand: "20", perDose: "1.3" });
    expect(!third.ok && third.error).toMatch(/whole or half tablets/);
    const half = await newOrder({ name: "Clonazepam", strength: "0.5 mg tablet", countOnHand: "29.5", perDose: "0.5" });
    expect(half.ok).toBe(true);
    expect(await orderRow(half.ok ? half.data!.id : "")).toMatchObject({ countTenths: 295, doseTenths: 5 });
  });

  it("takes a tablet off for each dose given, not for refused or held doses", async () => {
    const dose = (time: string, outcome: string, now: string) =>
      inOrg((tx) =>
        recordScheduledDose(tx, medCaregiver, { orderId: sertraline, scheduledFor: at(time).toISOString(), residentCode: c.residents.ben.wristbandCode, packageConfirmed: true, outcome, reason: outcome === "given" ? undefined : "Asleep" }, at(now)),
      );
    expect((await dose("08:00", "given", "08:05")).ok).toBe(true);
    expect((await orderRow(sertraline)).countTenths).toBe(290);
    expect((await dose("20:00", "refused", "20:05")).ok).toBe(true);
    expect((await orderRow(sertraline)).countTenths).toBe(290);
  });

  it("takes off as-needed doses too", async () => {
    const before = (await orderRow(c.orders.acetaminophen)).countTenths;
    expect(before).toBeNull();
    // Start counting the seeded as-needed acetaminophen, then give a dose.
    expect((await inOrg((tx) => adjustCount(tx, owner, c.orders.acetaminophen, { mode: "set", amount: "24", reason: "Counted by hand" }))).ok).toBe(true);
    const r = await inOrg((tx) =>
      recordPrnDose(tx, medCaregiver, { orderId: c.orders.acetaminophen, residentCode: c.residents.diego.wristbandCode, packageConfirmed: true, reason: "Headache" }, at("10:00")),
    );
    expect(r.ok).toBe(true);
    expect((await orderRow(c.orders.acetaminophen)).countTenths).toBe(230);
    // As-needed orders have no fixed rate, so no days-left estimate.
    expect(supplyOf(await orderRow(c.orders.acetaminophen))?.daysLeft).toBeNull();
  });

  it("lets owners add refills and correct counts (with a reason), audited; caregivers can't", async () => {
    expect((await inOrg((tx) => adjustCount(tx, medCaregiver, sertraline, { mode: "add", amount: "30" }))).ok).toBe(false);
    const noReason = await inOrg((tx) => adjustCount(tx, owner, sertraline, { mode: "set", amount: "10" }));
    expect(!noReason.ok && noReason.error).toMatch(/Say why/);
    const refill = await inOrg((tx) => adjustCount(tx, owner, sertraline, { mode: "add", amount: "30", reason: "Pharmacy delivery" }));
    expect(refill.ok && refill.message).toMatch(/59 on hand/);
    const fix = await inOrg((tx) => adjustCount(tx, owner, sertraline, { mode: "set", amount: "10", reason: "Counted by hand" }));
    expect(fix.ok).toBe(true);
    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, sertraline));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["tablets_refilled", "tablet_count_corrected"]));
    const corrected = logs.find((l) => l.action === "tablet_count_corrected")!.details as { before: number; after: number };
    expect(corrected).toMatchObject({ before: 59, after: 10 });
  });

  it("flags medications running low on the owner dashboard", async () => {
    // 10 tablets, 2 a day: 5 days left, under the 7-day threshold.
    const low = await inOrg((tx) => runningLow(tx, owner));
    expect(low.map((x) => x.o.id)).toContain(sertraline);
    expect(low.find((x) => x.o.id === sertraline)?.supply).toMatchObject({ daysLeft: 5, low: true });
  });
});
