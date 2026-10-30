import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { prnFollowups } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { signInShift, signOutShift } from "@/server/care";
import { notOnShift, onShiftOnly } from "@/server/shift-guard";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
let floater: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const now = new Date("2026-10-29T13:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  floater = { id: s.users.nurse.id, role: "caregiver", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
});

describe("caregivers record care only on shift", () => {
  it("blocks a caregiver who hasn't started a shift, and never blocks owners", async () => {
    const lena = { residentId: c.residents.lena.id };
    expect(await inOrg((tx) => notOnShift(tx, caregiver, lena))).toMatch(/Start your shift first/);
    expect(await inOrg((tx) => notOnShift(tx, owner, lena))).toBeNull();
    // By medication order, too (the give screens send the order, not the resident).
    expect(await inOrg((tx) => notOnShift(tx, caregiver, { orderId: c.orders.lisinopril }))).toMatch(/Start your shift/);
    let saved = false;
    const r = await inOrg((tx) => onShiftOnly(tx, caregiver, lena, async () => ((saved = true), { ok: true as const, message: "saved" })));
    expect(r.ok).toBe(false);
    expect(saved).toBe(false);
  });

  it("lets them record at the home they're on shift at, not another one", async () => {
    expect((await inOrg((tx) => signInShift(tx, caregiver, s.orgId, [s.facilities.cedarRidge], null, now))).ok).toBe(true);
    expect(await inOrg((tx) => notOnShift(tx, caregiver, { residentId: c.residents.lena.id }))).toBeNull();
    const r = await inOrg((tx) => onShiftOnly(tx, caregiver, { orderId: c.orders.lisinopril }, async () => ({ ok: true as const, message: "saved" })));
    expect(r.ok).toBe(true);
    // Someone on shift at Cedar Ridge is told to end it before recording for a Maple House resident.
    expect((await inOrg((tx) => signInShift(tx, floater, s.orgId, [s.facilities.cedarRidge, s.facilities.mapleHouse], s.facilities.cedarRidge, now))).ok).toBe(true);
    expect(await inOrg((tx) => notOnShift(tx, floater, { residentId: c.residents.ben.id }))).toMatch(/on shift at Cedar Ridge/);
    // As-needed follow-ups are checked through the follow-up's resident.
    const [f] = await db.insert(prnFollowups).values({ orgId: s.orgId, residentId: c.residents.ben.id, administrationId: await givenDose(), dueAt: now }).returning();
    expect(await inOrg((tx) => notOnShift(tx, caregiver, { followupId: f.id }))).toMatch(/on shift at Cedar Ridge/);
  });

  it("blocks again once the shift ends", async () => {
    expect((await inOrg((tx) => signOutShift(tx, caregiver, new Date(now.getTime() + 8 * 3_600_000)))).ok).toBe(true);
    expect(await inOrg((tx) => notOnShift(tx, caregiver, { residentId: c.residents.lena.id }))).toMatch(/Start your shift first/);
  });
});

/** A recorded dose to hang an as-needed follow-up on (only the link matters here). */
async function givenDose(): Promise<string> {
  const { administrations } = await import("@/db/schema");
  const [d] = await db
    .insert(administrations)
    .values({ orgId: s.orgId, residentId: c.residents.ben.id, orderId: c.orders.acetaminophen, outcome: "given", residentScanned: true, packageScanned: false, recordedBy: s.users.owner.id, recordedAt: now })
    .returning();
  return d.id;
}
