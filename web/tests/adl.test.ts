import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { adlEntries, auditLog, residents } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { adlTodayByHome, currentShiftAdl, monthAdl, recordAdl } from "@/server/adl";
import { deleteResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const lenaRow = async (tx: Pick<DB, "select">) => (await tx.select().from(residents).where(eq(residents.id, c.residents.lena.id)))[0];

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("daily care (ADLs)", () => {
  const morning = new Date("2026-10-28T13:00:00Z"); // 9 AM Eastern, day shift
  const lena = () => c.residents.lena.id;

  it("records this shift's activities, and needs a note for a refusal", async () => {
    const none = await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: {} }, morning));
    expect(!none.ok && none.error).toMatch(/at least one activity/);
    const bad = await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { dressing: "a lot" } }, morning));
    expect(bad.ok).toBe(false);
    const refusedNoNote = await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { bathing: "refused" } }, morning));
    expect(!refusedNoNote.ok && refusedNoNote.error).toMatch(/what was refused/);
    // Ben lives at Maple House, which Andre doesn't work at.
    expect((await inOrg((tx) => recordAdl(tx, caregiver, { residentId: c.residents.ben.id, entries: { eating: "independent" } }, morning))).ok).toBe(false);

    const r = await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { dressing: "independent", eating: "supervision", bathing: "" } }, morning));
    expect(r.ok && r.message).toMatch(/2 activities, day shift/);
    const rows = await db.select().from(adlEntries).where(eq(adlEntries.residentId, lena()));
    expect(rows.map((x) => x.activity).sort()).toEqual(["dressing", "eating"]);
    expect(rows.every((x) => x.shift === "day")).toBe(true);
    const [log] = await db.select().from(auditLog).where(eq(auditLog.action, "adl_recorded"));
    expect(log.entityId).toBe(lena());
  });

  it("shows the latest entry per activity for the current shift, and is permanent", async () => {
    const later = new Date(morning.getTime() + 2 * 3_600_000);
    await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { eating: "limited" } }, later));
    const shift = await inOrg(async (tx) => currentShiftAdl(tx, await lenaRow(tx), later));
    expect(shift.shift).toBe("day");
    expect(shift.latest.get("eating")?.support).toBe("limited");
    expect(shift.latest.get("dressing")?.support).toBe("independent");
    // The evening shift starts empty.
    const evening = await inOrg(async (tx) => currentShiftAdl(tx, await lenaRow(tx), new Date("2026-10-28T21:00:00Z")));
    expect(evening.latest.size).toBe(0);
    await expect(inOrg((tx) => tx.update(adlEntries).set({ support: "total" }))).rejects.toThrow();
  });

  it("builds a month grid with the most help given each day, and counts residents for the dashboard", async () => {
    await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { bathing: "refused" }, note: "Refused shower, washed at the sink." }, new Date("2026-10-28T23:30:00Z")));
    // Night shift after midnight counts toward the day it started.
    await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { toileting: "limited" } }, new Date("2026-10-29T07:00:00Z")));
    const m = await inOrg(async (tx) => monthAdl(tx, await lenaRow(tx), 2026, 10));
    expect(m.days).toBe(31);
    expect(m.grid.eating[27]).toBe("limited");
    expect(m.grid.dressing[27]).toBe("independent");
    expect(m.grid.bathing[27]).toBe("refused");
    expect(m.grid.toileting[27]).toBe("limited");
    expect(m.grid.eating[26]).toBeNull();
    expect(m.notes.map((n) => n.note)).toContain("Refused shower, washed at the sink.");
    const today = await inOrg((tx) => adlTodayByHome(tx, [s.facilities.cedarRidge, s.facilities.mapleHouse], new Date("2026-10-28T22:00:00Z")));
    expect(today.get(s.facilities.cedarRidge)).toBe(1);
    expect(today.get(s.facilities.mapleHouse)).toBe(0);
    // A resident with daily care recorded has records, so can't be deleted as added by mistake.
    expect((await inOrg((tx) => deleteResident(tx, owner, lena(), { reason: "test" }))).ok).toBe(false);
  });
});
