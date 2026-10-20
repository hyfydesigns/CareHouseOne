import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { administrations, auditLog, medicationOrders, prnFollowups } from "@/db/schema";
import { allergyConflict } from "@/lib/allergy";
import type { Actor } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/time";
import { createOrder, medicationPass, monthRecord, recordFollowup, recordPrnDose, recordScheduledDose, stopOrder } from "@/server/meds";
import { createResident, getResident } from "@/server/residents";
import { setResidentCheck } from "@/server/org";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

const TZ = "America/New_York";
const DAY = "2026-10-16";
const at = (time: string) => zonedToUtc(DAY, time, TZ);
const slot8 = at("08:00").toISOString();

let db: DB;
let s: Seeded;
let c: SeededCare;
let other: Seeded;
let nurse: Actor;
let medCaregiver: Actor;
let caregiver: Actor;
let manager: Actor;

const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2], orgId = s.orgId) => withTenant(db, orgId, fn);

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
  await seedCare(db, other);
  const both = [s.facilities.cedarRidge, s.facilities.mapleHouse];
  nurse = { id: s.users.nurse.id, role: "nurse", facilityIds: both };
  medCaregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  caregiver = { id: s.users.caregiver.id, role: "caregiver", facilityIds: [s.facilities.cedarRidge] };
  manager = { id: s.users.manager.id, role: "manager", facilityIds: [s.facilities.cedarRidge] };
});

describe("allergy matching", () => {
  it("matches drug families, not just exact names", () => {
    expect(allergyConflict(["Sulfa drugs (rash)"], "Bactrim DS")).toBe("Sulfa drugs (rash)");
    expect(allergyConflict(["Penicillin (hives)"], "Amoxicillin")).toBe("Penicillin (hives)");
    expect(allergyConflict(["Penicillin (hives)"], "Lisinopril")).toBeNull();
    expect(allergyConflict(["Latex"], "Acetaminophen")).toBeNull();
  });
});

describe("residents", () => {
  it("lets nurses add residents with a wristband code, but not caregivers", async () => {
    const ok = await inOrg((tx) => createResident(tx, nurse, s.orgId, { facilityId: s.facilities.mapleHouse, firstName: "Tasha", lastName: "Moore", room: "2", allergies: "Latex, Codeine" }));
    expect(ok.ok).toBe(true);
    const r = ok.ok ? await inOrg((tx) => getResident(tx, nurse, ok.data!.id)) : null;
    expect(r?.wristbandCode).toMatch(/^R-[A-Z2-9]{8}$/);
    expect(r?.allergies).toEqual(["Latex", "Codeine"]);
    const no = await inOrg((tx) => createResident(tx, medCaregiver, s.orgId, { facilityId: s.facilities.cedarRidge, firstName: "X", lastName: "Y" }));
    expect(no.ok).toBe(false);
  });

  it("hides residents of homes the user isn't assigned to", async () => {
    expect(await inOrg((tx) => getResident(tx, manager, c.residents.ben.id))).toBeNull();
    expect(await inOrg((tx) => getResident(tx, nurse, c.residents.ben.id))).not.toBeNull();
  });
});

describe("medication orders", () => {
  const now = at("09:00");
  it("blocks an order that conflicts with an allergy and logs it", async () => {
    const r = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "Bactrim", strength: "800 mg tablet", route: "By mouth", purpose: "Infection", type: "scheduled", times: ["08:00"], startDate: DAY }, now));
    expect(!r.ok && r.error).toMatch(/allergic to Sulfa/);
    const logged = await db.select().from(auditLog).where(eq(auditLog.action, "order_blocked_allergy"));
    expect(logged.length).toBe(1);
  });

  it("blocks a duplicate active medication", async () => {
    const r = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "amlodipine", strength: "10 mg tablet", route: "By mouth", purpose: "BP", type: "scheduled", times: ["20:00"], startDate: DAY }, now));
    expect(!r.ok && r.error).toMatch(/already on Diego/);
  });

  it("validates scheduled and as-needed details, and stop dates", async () => {
    const noTimes = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "Vitamin D", strength: "1000 IU", route: "By mouth", purpose: "Supplement", type: "scheduled", startDate: DAY }, now));
    const noReason = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "Ibuprofen", strength: "200 mg", route: "By mouth", purpose: "Pain", type: "prn", prnMinIntervalHours: 6, prnMaxPerDay: 3, startDate: DAY }, now));
    const pastStop = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "Cephalexin", strength: "500 mg", route: "By mouth", purpose: "UTI", type: "scheduled", times: ["08:00"], startDate: "2026-10-10", stopDate: DAY }, now));
    expect([noTimes.ok, noReason.ok, pastStop.ok]).toEqual([false, false, false]);
    const good = await inOrg((tx) => createOrder(tx, nurse, s.orgId, c.residents.diego.id, { name: "Cephalexin", strength: "500 mg capsule", route: "By mouth", purpose: "UTI", type: "scheduled", times: ["20:00", "08:00"], startDate: DAY, stopDate: "2026-10-20" }, now));
    expect(good.ok).toBe(true);
    const [row] = await db.select().from(medicationOrders).where(eq(medicationOrders.name, "Cephalexin"));
    expect(row.times).toEqual(["08:00", "20:00"]);
  });

  it("doesn't let caregivers enter orders", async () => {
    const r = await inOrg((tx) => createOrder(tx, medCaregiver, s.orgId, c.residents.diego.id, { name: "Vitamin C", strength: "500 mg", route: "By mouth", purpose: "Supplement", type: "scheduled", times: ["08:00"], startDate: DAY }, now));
    expect(r.ok).toBe(false);
  });
});

describe("medication pass", () => {
  it("lists today's doses with due, upcoming and late states", async () => {
    const pass = await inOrg((tx) => medicationPass(tx, medCaregiver, s.facilities.cedarRidge, at("08:20")));
    const lena = pass!.find((p) => p.resident.id === c.residents.lena.id)!;
    expect(lena.slots.map((x) => `${x.order.name} ${x.time} ${x.state}`)).toEqual(["Lisinopril 08:00 due", "Omeprazole 08:00 due", "Sertraline 08:00 due", "Sertraline 20:00 upcoming"]);
    const later = await inOrg((tx) => medicationPass(tx, medCaregiver, s.facilities.cedarRidge, at("09:30")));
    expect(later!.find((p) => p.resident.id === c.residents.lena.id)!.slots[0].state).toBe("late");
  });

  it("won't show another home's pass", async () => {
    expect(await inOrg((tx) => medicationPass(tx, manager, s.facilities.mapleHouse, at("08:20")))).toBeNull();
  });

  const base = () => ({ orderId: c.orders.omeprazole, scheduledFor: slot8, residentCode: c.residents.lena.wristbandCode, packageConfirmed: true, outcome: "given" });

  it("stops on the wrong resident's wristband and logs it", async () => {
    const r = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...base(), residentCode: c.residents.diego.wristbandCode }, at("08:10")));
    expect(!r.ok && r.stop).toBe("wrong_resident");
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "medication_stop"))).length).toBeGreaterThan(0);
  });

  it("needs the package label confirmed, or the package scanned when it has a code", async () => {
    const unconfirmed = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...base(), packageConfirmed: false }, at("08:10")));
    expect(unconfirmed.ok).toBe(false);
    const wrongPkg = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...base(), orderId: c.orders.lisinopril, packageCode: "WRONG", bpSystolic: 128, bpDiastolic: 80 }, at("08:10")));
    expect(!wrongPkg.ok && wrongPkg.stop).toBe("wrong_medication");
  });

  it("only lets nurses and med-certified caregivers give medications", async () => {
    const r = await inOrg((tx) => recordScheduledDose(tx, caregiver, base(), at("08:10")));
    expect(!r.ok && r.error).toMatch(/med-certified/);
  });

  it("records a dose once, and stops a second attempt", async () => {
    const first = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, base(), at("08:10")));
    expect(first.ok).toBe(true);
    const again = await inOrg((tx) => recordScheduledDose(tx, nurse, base(), at("08:15")));
    expect(!again.ok && again.stop).toBe("duplicate");
  });

  it("requires blood pressure first and holds the dose when the top number is under 100", async () => {
    const lis = { ...base(), orderId: c.orders.lisinopril, packageCode: "lis10-lk" };
    expect((await inOrg((tx) => recordScheduledDose(tx, medCaregiver, lis, at("08:10")))).ok).toBe(false);
    const low = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...lis, bpSystolic: 94, bpDiastolic: 60 }, at("08:10")));
    expect(!low.ok && low.stop).toBe("bp_hold");
    const held = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...lis, outcome: "held", reason: "BP 94/60, under 100", bpSystolic: 94, bpDiastolic: 60 }, at("08:11")));
    expect(held.ok).toBe(true);
  });

  it("won't record a dose more than 60 minutes early, and flags late doses", async () => {
    const early = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...base(), orderId: c.orders.sertraline, scheduledFor: at("20:00").toISOString() }, at("08:30")));
    expect(!early.ok && early.error).toMatch(/isn't due until 8:00 PM/);
    const late = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...base(), orderId: c.orders.sertraline }, at("09:45")));
    expect(late.ok && late.message).toMatch(/Marked late/);
  });

  it("needs a reason for refused doses", async () => {
    const met = { orderId: c.orders.metformin, scheduledFor: slot8, residentCode: c.residents.marcus.wristbandCode, outcome: "refused" };
    expect((await inOrg((tx) => recordScheduledDose(tx, medCaregiver, met, at("08:10")))).ok).toBe(false);
    expect((await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...met, reason: "Said he'd take it after breakfast; offered again at 08:40" }, at("08:10")))).ok).toBe(true);
  });

  it("keeps dose records permanent", async () => {
    const why = (q: Promise<unknown>) => q.then(() => "no error", (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message);
    expect(await why(inOrg((tx) => tx.execute(sql`update administrations set outcome = 'refused'`)))).toMatch(/permission denied/);
    expect(await why(inOrg((tx) => tx.execute(sql`delete from administrations`)))).toMatch(/permission denied/);
  });
});

describe("as-needed doses and follow-ups", () => {
  const prn = () => ({ orderId: c.orders.acetaminophen, residentCode: c.residents.diego.wristbandCode, packageConfirmed: true, reason: "Headache" });

  it("needs a reason from the order", async () => {
    expect((await inOrg((tx) => recordPrnDose(tx, medCaregiver, { ...prn(), reason: "Because" }, at("10:00")))).ok).toBe(false);
  });

  it("gives a dose, creates a follow-up for 60 minutes later, and enforces the gap", async () => {
    const r = await inOrg((tx) => recordPrnDose(tx, medCaregiver, prn(), at("10:00")));
    expect(r.ok && r.message).toMatch(/Check how it worked at 11:00 AM/);
    const soon = await inOrg((tx) => recordPrnDose(tx, medCaregiver, prn(), at("13:00")));
    expect(!soon.ok && soon.stop).toBe("too_soon");
    expect(!soon.ok && soon.error).toMatch(/next is allowed at 4:00 PM/);
    const [f] = await db.select().from(prnFollowups).where(eq(prnFollowups.residentId, c.residents.diego.id));
    expect(f.dueAt.getTime()).toBe(at("11:00").getTime());
    const done = await inOrg((tx) => recordFollowup(tx, medCaregiver, { followupId: f.id, result: "effective", note: "Headache gone" }, at("11:05")));
    expect(done.ok).toBe(true);
    expect((await inOrg((tx) => recordFollowup(tx, medCaregiver, { followupId: f.id, result: "effective" }, at("11:06")))).ok).toBe(false);
  });

  it("stops at the daily maximum", async () => {
    for (const t of ["16:00", "22:00"]) expect((await inOrg((tx) => recordPrnDose(tx, nurse, prn(), at(t)))).ok).toBe(true);
    await db.update(medicationOrders).set({ prnMinIntervalMinutes: 30 }).where(eq(medicationOrders.id, c.orders.acetaminophen));
    expect((await inOrg((tx) => recordPrnDose(tx, nurse, prn(), at("22:40")))).ok).toBe(true);
    const fifth = await inOrg((tx) => recordPrnDose(tx, nurse, prn(), at("23:20")));
    expect(!fifth.ok && fifth.stop).toBe("max_reached");
  });
});

describe("stopping orders and the monthly record", () => {
  it("removes a stopped order from the pass but keeps its doses", async () => {
    expect((await inOrg((tx) => stopOrder(tx, nurse, c.orders.omeprazole, "Prescriber stopped it"))).ok).toBe(true);
    const pass = await inOrg((tx) => medicationPass(tx, medCaregiver, s.facilities.cedarRidge, at("08:30")));
    const lena = pass!.find((p) => p.resident.id === c.residents.lena.id)!;
    expect(lena.slots.some((x) => x.order.name === "Omeprazole")).toBe(false);
    expect((await db.select().from(administrations).where(eq(administrations.orderId, c.orders.omeprazole))).length).toBe(1);
  });

  it("builds the month grid with initials, held doses and missed doses", async () => {
    const lena = (await inOrg((tx) => getResident(tx, nurse, c.residents.lena.id)))!;
    const m = await inOrg((tx) => monthRecord(tx, lena, 2026, 10, at("21:30")));
    expect(m.days).toBe(31);
    const row = (name: string, time: string) => m.rows.find((r) => r.order.name === name && r.time === time)!;
    expect(row("Omeprazole", "08:00").cells[15]).toMatchObject({ outcome: "given", by: "AT" });
    expect(row("Lisinopril", "08:00").cells[15]).toMatchObject({ outcome: "held" });
    expect(row("Sertraline", "08:00").cells[15]).toMatchObject({ outcome: "given", late: true });
    expect(row("Sertraline", "20:00").cells[15]).toMatchObject({ outcome: "missed" });
    expect(row("Lisinopril", "08:00").cells[16]).toBeNull();
  });
});

describe("resident check setting", () => {
  const amlo = () => ({ orderId: c.orders.amlodipine, scheduledFor: slot8, packageConfirmed: true, outcome: "given" });
  const owner = (): Actor => ({ id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] });

  it("defaults to two identifiers: no wristband needed, but the caregiver must confirm", async () => {
    const unconfirmed = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, amlo(), at("08:05")));
    expect(!unconfirmed.ok && unconfirmed.error).toMatch(/name and date of birth/);
    const ok = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...amlo(), residentConfirmed: true }, at("08:05")));
    expect(ok.ok).toBe(true);
    const [dose] = await db.select().from(administrations).where(eq(administrations.orderId, c.orders.amlodipine));
    expect(dose.residentScanned).toBe(false);
  });

  it("only lets owners and admins change it, and logs the change", async () => {
    expect((await inOrg((tx) => setResidentCheck(tx, nurse, s.orgId, "wristband"))).ok).toBe(false);
    expect((await inOrg((tx) => setResidentCheck(tx, owner(), s.orgId, "wristband"))).ok).toBe(true);
    const logged = await db.select().from(auditLog).where(eq(auditLog.action, "setting_changed"));
    expect(logged[0]?.details).toMatchObject({ from: "two_identifiers", to: "wristband" });
  });

  it("in wristband mode, requires a scan even if the caregiver ticks the confirmation", async () => {
    const met = { orderId: c.orders.metformin, scheduledFor: at("17:00").toISOString(), packageConfirmed: true, outcome: "given", residentConfirmed: true };
    const noScan = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, met, at("17:05")));
    expect(!noScan.ok && noScan.error).toMatch(/Scan the resident's wristband/);
    const scanned = await inOrg((tx) => recordScheduledDose(tx, medCaregiver, { ...met, residentCode: c.residents.marcus.wristbandCode }, at("17:05")));
    expect(scanned.ok).toBe(true);
    await inOrg((tx) => setResidentCheck(tx, owner(), s.orgId, "two_identifiers"));
  });
});

describe("tenant isolation", () => {
  it("never shows medication records across organizations", async () => {
    const seen = await withTenant(db, other.orgId, (tx) => tx.select().from(administrations));
    expect(seen.every((a) => a.orgId === other.orgId)).toBe(true);
    const orders = await withTenant(db, other.orgId, (tx) => tx.select().from(medicationOrders).where(eq(medicationOrders.id, c.orders.lisinopril)));
    expect(orders).toHaveLength(0);
  });
});
