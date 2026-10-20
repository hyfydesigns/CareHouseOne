import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { icd10Codes, progressNotes, residentDiagnoses, shiftPunches, vitals } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/time";
import { addNote, monthNotes, monthVitals, myShifts, recordVitals, reviewVital, shiftAt, signInShift, signOutShift, todayAtHome, unreviewedVitals } from "@/server/care";
import { addDiagnosis, childCodes, listDiagnoses, removeDiagnosis, searchIcd } from "@/server/diagnoses";
import { getResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

const TZ = "America/New_York";
const at = (time: string, day = "2026-10-16") => zonedToUtc(day, time, TZ);

let db: DB;
let s: Seeded;
let c: SeededCare;
let other: Seeded;
let nurse: Actor;
let caregiver: Actor;
let manager: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2], orgId = s.orgId) => withTenant(db, orgId, fn);
const why = (q: Promise<unknown>) => q.then(() => "no error", (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message);

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
  await seedCare(db, other);
  nurse = { id: s.users.nurse.id, role: "nurse", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "caregiver", facilityIds: [s.facilities.cedarRidge] };
  manager = { id: s.users.manager.id, role: "manager", facilityIds: [s.facilities.cedarRidge] };
});

describe("vital signs", () => {
  const base = () => ({ residentId: c.residents.lena.id, systolic: "128", diastolic: "80", pulse: "72", temperature: "98.4", oxygen: "97", weight: "142.5" });

  it("needs blood pressure and pulse, and rejects impossible values", async () => {
    expect((await inOrg((tx) => recordVitals(tx, caregiver, { residentId: c.residents.lena.id, systolic: "120" }, at("09:00")))).ok).toBe(false);
    const bad = await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), temperature: "120" }, at("09:00")));
    expect(!bad.ok && bad.error).toMatch(/temperature doesn't look possible/);
  });

  it("saves a normal reading with temperature and weight in exact tenths", async () => {
    const r = await inOrg((tx) => recordVitals(tx, caregiver, base(), at("09:00")));
    expect(r.ok && r.data?.flags).toEqual([]);
    const [v] = await db.select().from(vitals).where(eq(vitals.residentId, c.residents.lena.id));
    expect([v.tempTenthsF, v.weightTenthsLb]).toEqual([984, 1425]);
  });

  it("flags out-of-range readings for the nurse, who can mark them reviewed", async () => {
    const r = await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), systolic: "172", diastolic: "96", temperature: "100.8" }, at("10:00")));
    expect(r.ok && r.data?.flags).toEqual(["blood pressure", "temperature"]);
    expect(r.ok && r.message).toMatch(/tell the nurse/);
    const list = await inOrg((tx) => unreviewedVitals(tx, nurse));
    expect(list).toHaveLength(1);
    expect((await inOrg((tx) => reviewVital(tx, caregiver, list[0].v.id, ""))).ok).toBe(false);
    expect((await inOrg((tx) => reviewVital(tx, nurse, list[0].v.id, "Rechecked at 10:30: 138/84"))).ok).toBe(true);
    expect(await inOrg((tx) => unreviewedVitals(tx, nurse))).toHaveLength(0);
  });

  it("shows the month with averages and keeps readings permanent", async () => {
    const lena = (await inOrg((tx) => getResident(tx, nurse, c.residents.lena.id)))!;
    const m = await inOrg((tx) => monthVitals(tx, lena, 2026, 10));
    expect(m.rows).toHaveLength(2);
    expect(m.averageBp).toBe("150/88");
    expect(m.flagged).toBe(1);
    expect(await why(inOrg((tx) => tx.execute(sql`update vitals set systolic = 100`)))).toMatch(/permission denied/);
  });

  it("won't record for a resident in another home", async () => {
    const r = await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), residentId: c.residents.ben.id }, at("09:00")));
    expect(r.ok).toBe(false);
  });
});

describe("progress notes", () => {
  it("knows the shift from the time of day", () => {
    expect([shiftAt("08:00"), shiftAt("15:00"), shiftAt("23:30"), shiftAt("06:59")]).toEqual(["day", "evening", "night", "night"]);
  });

  it("saves notes, rejects very short ones, and adds addenda instead of edits", async () => {
    const short = await inOrg((tx) => addNote(tx, caregiver, { residentId: c.residents.diego.id, shift: "day", category: "general", body: "fine" }, at("11:00")));
    expect(short.ok).toBe(false);
    const ok = await inOrg((tx) => addNote(tx, caregiver, { residentId: c.residents.diego.id, shift: "day", category: "activity", body: "Diego joined the group walk and ate all of lunch." }, at("11:00")));
    expect(ok.ok).toBe(true);
    const [n] = await db.select().from(progressNotes).where(eq(progressNotes.residentId, c.residents.diego.id));
    const add = await inOrg((tx) => addNote(tx, caregiver, { residentId: c.residents.diego.id, shift: "day", category: "activity", body: "Correction: the walk was at 10:30, not 10:00.", addendumTo: n.id }, at("11:30")));
    expect(add.ok).toBe(true);
    const diego = (await inOrg((tx) => getResident(tx, nurse, c.residents.diego.id)))!;
    const m = await inOrg((tx) => monthNotes(tx, diego, 2026, 10));
    expect(m.rows.map((r) => !!r.n.addendumTo)).toEqual([true, false]);
    expect(await why(inOrg((tx) => tx.execute(sql`update progress_notes set body = 'changed'`)))).toMatch(/permission denied/);
    expect(await why(inOrg((tx) => tx.execute(sql`delete from progress_notes`)))).toMatch(/permission denied/);
  });
});

describe("shift sign-in and sign-out", () => {
  it("signs in at an assigned home once, then signs out with hours", async () => {
    expect((await inOrg((tx) => signInShift(tx, caregiver, s.orgId, s.facilities.mapleHouse, at("06:50")))).ok).toBe(false);
    expect((await inOrg((tx) => signInShift(tx, caregiver, s.orgId, s.facilities.cedarRidge, at("06:50")))).ok).toBe(true);
    const twice = await inOrg((tx) => signInShift(tx, caregiver, s.orgId, s.facilities.cedarRidge, at("06:55")));
    expect(!twice.ok && twice.error).toMatch(/already signed in/);
    const today = await inOrg((tx) => todayAtHome(tx, manager, s.facilities.cedarRidge, at("09:00")));
    expect(today.map((t) => t.name)).toEqual(["Andre Thomas"]);
    const out = await inOrg((tx) => signOutShift(tx, caregiver, at("15:05")));
    expect(out.ok && out.message).toMatch(/8\.3 hours/);
    expect((await inOrg((tx) => signOutShift(tx, caregiver, at("15:06")))).ok).toBe(false);
    const mine = await inOrg((tx) => myShifts(tx, caregiver, s.facilities.cedarRidge, 2026, 10));
    expect(mine.total).toBeCloseTo(8.25, 1);
  });

  it("allows only one open shift per person at the database level", async () => {
    await db.insert(shiftPunches).values({ orgId: s.orgId, userId: s.users.nurse.id, facilityId: s.facilities.cedarRidge, signedInAt: at("07:00") });
    await expect(db.insert(shiftPunches).values({ orgId: s.orgId, userId: s.users.nurse.id, facilityId: s.facilities.mapleHouse, signedInAt: at("07:05") })).rejects.toThrow();
  });
});

describe("ICD-10-CM diagnoses", () => {
  it("searches by code or words, marking categories", async () => {
    const byWord = await inOrg((tx) => searchIcd(tx, "epilepsy"));
    expect(byWord.map((x) => x.code)).toEqual(expect.arrayContaining(["G40", "G40.909", "G40.919"]));
    const byCode = await inOrg((tx) => searchIcd(tx, "e11"));
    expect(byCode.find((x) => x.code === "E11")?.billable).toBe(false);
    expect((await inOrg((tx) => childCodes(tx, "G40"))).every((x) => x.billable)).toBe(true);
    expect(await inOrg((tx) => searchIcd(tx, "%"))).toEqual([]);
  });

  it("adds billable codes only, blocks duplicates, and only for nurses and managers", async () => {
    const cat = await inOrg((tx) => addDiagnosis(tx, nurse, { residentId: c.residents.diego.id, code: "G40" }));
    expect(!cat.ok && cat.error).toMatch(/category/);
    expect((await inOrg((tx) => addDiagnosis(tx, nurse, { residentId: c.residents.diego.id, code: "Z99.999" }))).ok).toBe(false);
    expect((await inOrg((tx) => addDiagnosis(tx, caregiver, { residentId: c.residents.diego.id, code: "G40.919" }))).ok).toBe(false);
    expect((await inOrg((tx) => addDiagnosis(tx, nurse, { residentId: c.residents.diego.id, code: "g40.919", label: "Epilepsy (hard to control)" }))).ok).toBe(true);
    const dup = await inOrg((tx) => addDiagnosis(tx, nurse, { residentId: c.residents.diego.id, code: "G40.919" }));
    expect(!dup.ok && dup.error).toMatch(/already/);
  });

  it("removes into history instead of deleting", async () => {
    const list = await inOrg((tx) => listDiagnoses(tx, c.residents.diego.id));
    const epi = list.find((d) => d.code === "G40.919")!;
    expect((await inOrg((tx) => removeDiagnosis(tx, nurse, epi.id, "Entered in error")))).toMatchObject({ ok: true });
    const after = await inOrg((tx) => listDiagnoses(tx, c.residents.diego.id));
    expect(after.find((d) => d.code === "G40.919")?.removeReason).toBe("Entered in error");
    expect(await why(inOrg((tx) => tx.execute(sql`delete from resident_diagnoses`)))).toMatch(/permission denied/);
  });

  it("flags diagnoses whose code is gone from the newest code set", async () => {
    // Simulate next year's load: every sample code moves to FY 2028 except F32.A.
    await db.update(icd10Codes).set({ version: "FY 2028" }).where(sql`${icd10Codes.code} <> 'F32.A'`);
    const lena = await inOrg((tx) => listDiagnoses(tx, c.residents.lena.id));
    expect(lena.find((d) => d.code === "F32.A")?.needsUpdate).toBe(true);
    expect(lena.find((d) => d.code === "I10")?.needsUpdate).toBe(false);
    const stale = await inOrg((tx) => addDiagnosis(tx, nurse, { residentId: c.residents.marcus.id, code: "F32.A" }));
    expect(!stale.ok && stale.error).toMatch(/current code set/);
    await db.update(icd10Codes).set({ version: "FY 2027" });
  });

  it("keeps the code list read-only and diagnoses inside their organization", async () => {
    expect(await why(inOrg((tx) => tx.execute(sql`update icd10_codes set description = 'x'`)))).toMatch(/permission denied/);
    const seen = await withTenant(db, other.orgId, (tx) => tx.select().from(residentDiagnoses));
    expect(seen.every((d) => d.orgId === other.orgId)).toBe(true);
  });
});

describe("blood sugar and blood pressure position", () => {
  const base = () => ({ residentId: c.residents.diego.id, systolic: "128", diastolic: "80", pulse: "72" });

  it("records blood sugar and how blood pressure was taken, and flags low or high sugar", async () => {
    const low = await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), residentId: c.residents.diego.id, bloodSugar: "55", bpPosition: "lying" }, at("06:30", "2026-10-18")));
    expect(low.ok && low.data?.flags).toEqual(["blood sugar"]);
    expect(low.ok && low.message).toMatch(/Blood sugar outside the usual range/);
    const [row] = await db.select().from(vitals).where(eq(vitals.bloodSugar, 55));
    expect(row).toMatchObject({ bpPosition: "lying", respirations: null });

    const normal = await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), residentId: c.residents.diego.id, bloodSugar: "110", bpPosition: "sitting" }, at("06:40", "2026-10-18")));
    expect(normal.ok && normal.data?.flags).toEqual([]);
    expect((await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), residentId: c.residents.diego.id, bloodSugar: "1000" }, at("06:45", "2026-10-18")))).ok).toBe(false);
    expect((await inOrg((tx) => recordVitals(tx, caregiver, { ...base(), residentId: c.residents.diego.id, bpPosition: "standing" }, at("06:45", "2026-10-18")))).ok).toBe(false);
  });
});
