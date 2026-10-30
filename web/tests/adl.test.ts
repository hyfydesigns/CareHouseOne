import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { adlEntries, auditLog, residents } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { ADL_ACTIVITIES, addActivity, adlTodayByHome, currentShiftAdl, listActivities, monthAdl, recordAdl, setActivityHidden } from "@/server/adl";
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
    const cell = (key: string, day: number) => m.rows.find((r) => r.key === key)!.cells[day];
    expect(m.rows.map((r) => r.name)).toContain("Mobility and transfers");
    expect(cell("eating", 27)).toBe("limited");
    expect(cell("dressing", 27)).toBe("independent");
    expect(cell("bathing", 27)).toBe("refused");
    expect(cell("toileting", 27)).toBe("limited");
    expect(cell("eating", 26)).toBeNull();
    expect(m.notes.map((n) => n.note)).toContain("Refused shower, washed at the sink.");
    const today = await inOrg((tx) => adlTodayByHome(tx, [s.facilities.cedarRidge, s.facilities.mapleHouse], new Date("2026-10-28T22:00:00Z")));
    expect(today.get(s.facilities.cedarRidge)).toBe(1);
    expect(today.get(s.facilities.mapleHouse)).toBe(0);
    // A resident with daily care recorded has records, so can't be deleted as added by mistake.
    expect((await inOrg((tx) => deleteResident(tx, owner, lena(), { reason: "test" }))).ok).toBe(false);
  });

  it("lets owners and admins add and hide activities, keeping history", async () => {
    expect((await inOrg((tx) => listActivities(tx))).length).toBe(7);
    expect((await inOrg((tx) => addActivity(tx, caregiver, s.orgId, "Laundry"))).ok).toBe(false);
    expect((await inOrg((tx) => addActivity(tx, owner, s.orgId, "x"))).ok).toBe(false);
    const dupe = await inOrg((tx) => addActivity(tx, owner, s.orgId, "dressing"));
    expect(!dupe.ok && dupe.error).toMatch(/already on the list/);
    expect((await inOrg((tx) => addActivity(tx, owner, s.orgId, "Laundry"))).ok).toBe(true);
    const list = await inOrg((tx) => listActivities(tx));
    expect(list.map((a) => a.name)).toEqual([...Object.values(ADL_ACTIVITIES), "Laundry"]);
    const laundry = list.find((a) => a.name === "Laundry")!;
    expect(laundry.builtIn).toBe(false);

    // Caregivers record the new activity like any other.
    const nov = new Date("2026-11-03T14:00:00Z");
    expect((await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { [laundry.key]: "supervision", eating: "independent" } }, nov))).ok).toBe(true);
    // Hide eating: it's no longer offered, but November's record still shows it.
    expect((await inOrg((tx) => setActivityHidden(tx, caregiver, s.orgId, "eating", true))).ok).toBe(false);
    expect((await inOrg((tx) => setActivityHidden(tx, owner, s.orgId, "eating", true))).ok).toBe(true);
    expect((await inOrg((tx) => listActivities(tx))).map((a) => a.key)).not.toContain("eating");
    const hiddenPick = await inOrg((tx) => recordAdl(tx, caregiver, { residentId: lena(), entries: { eating: "independent" } }, nov));
    expect(hiddenPick.ok).toBe(false);
    const m = await inOrg(async (tx) => monthAdl(tx, await lenaRow(tx), 2026, 11));
    expect(m.rows.find((r) => r.name === "Laundry")?.cells[2]).toBe("supervision");
    expect(m.rows.find((r) => r.key === "eating")).toMatchObject({ hidden: true });
    expect(m.rows.find((r) => r.key === "eating")?.cells[2]).toBe("independent");
    // Activities not recorded and hidden don't clutter the grid; showing one again brings it back.
    expect((await inOrg((tx) => setActivityHidden(tx, owner, s.orgId, "continence", true))).ok).toBe(true);
    expect((await inOrg(async (tx) => monthAdl(tx, await lenaRow(tx), 2026, 11))).rows.some((r) => r.key === "continence")).toBe(false);
    expect((await inOrg((tx) => setActivityHidden(tx, owner, s.orgId, "continence", false))).ok).toBe(true);
    // Adding a hidden activity's name again shows it.
    const back = await inOrg((tx) => addActivity(tx, owner, s.orgId, "Eating"));
    expect(back.ok && back.message).toMatch(/back on the list/);
  });
});
