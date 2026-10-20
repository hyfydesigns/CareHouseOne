import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, progressNotes, prnFollowups, sessions, shiftPunches, users } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { zonedToUtc } from "@/lib/time";
import { medicationPass, recordFollowup, recordPrnDose } from "@/server/meds";
import { dischargeResident, getResident, listDischarged, listResidents, readmitResident, updateResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";
import { inviteStaff, updateStaff } from "@/server/staff";
import { timesheet, timesheetCsv } from "@/server/timesheets";

const TZ = "America/New_York";
const at = (time: string, day = "2026-10-16") => zonedToUtc(day, time, TZ);

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let medCaregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const both = () => [s.facilities.cedarRidge, s.facilities.mapleHouse];

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: both() };
  medCaregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: both() };
});

describe("editing residents", () => {
  const values = (over: Record<string, unknown> = {}) => ({
    facilityId: s.facilities.cedarRidge,
    firstName: "Lena",
    lastName: "Kim",
    room: "2",
    allergies: "Penicillin (hives), Latex",
    diet: "Low sodium",
    codeStatus: "DNR",
    guardian: "Sam Kim (brother)",
    ...over,
  });

  it("lets owners change details and records which fields changed", async () => {
    const lena = c.residents.lena.id;
    const r = await inOrg((tx) => updateResident(tx, owner, lena, values()));
    expect(r.ok).toBe(true);
    const after = await inOrg((tx) => getResident(tx, owner, lena));
    expect(after).toMatchObject({ allergies: ["Penicillin (hives)", "Latex"], diet: "Low sodium", codeStatus: "DNR", guardian: "Sam Kim (brother)" });
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.action, "resident_updated"), eq(auditLog.entityId, lena)));
    expect((log.details as { fields: string[] }).fields).toEqual(expect.arrayContaining(["allergies", "diet", "codeStatus", "guardian"]));
    expect((log.details as { allergiesAfter: string[] }).allergiesAfter).toContain("Latex");
  });

  it("doesn't let caregivers change residents", async () => {
    const r = await inOrg((tx) => updateResident(tx, medCaregiver, c.residents.lena.id, values({ diet: "Regular" })));
    expect(r.ok).toBe(false);
  });

  it("discharges (off the medication pass, records kept) and readmits", async () => {
    const diego = c.residents.diego.id;
    const home = (await inOrg((tx) => getResident(tx, owner, diego)))!.facilityId;
    expect((await inOrg((tx) => dischargeResident(tx, owner, diego, { date: "2026-10-16", reason: "x" }))).ok).toBe(false);
    expect((await inOrg((tx) => dischargeResident(tx, owner, diego, { date: "2026-10-16", reason: "Moved to another provider" }))).ok).toBe(true);
    expect((await inOrg((tx) => listResidents(tx, owner))).some((r) => r.id === diego)).toBe(false);
    expect((await inOrg((tx) => listDischarged(tx, owner))).map((r) => r.id)).toContain(diego);
    const pass = await inOrg((tx) => medicationPass(tx, owner, home, at("08:00")));
    expect(pass!.some((p) => p.resident.id === diego)).toBe(false);
    expect((await inOrg((tx) => getResident(tx, owner, diego)))?.dischargeReason).toBe("Moved to another provider");

    expect((await inOrg((tx) => readmitResident(tx, owner, diego, { date: "2026-10-17" }))).ok).toBe(true);
    const back = await inOrg((tx) => getResident(tx, owner, diego));
    expect(back).toMatchObject({ status: "active", admittedOn: "2026-10-17", dischargedOn: null });
  });
});

describe("editing staff", () => {
  it("changes a caregiver's role and signs them out", async () => {
    await db.insert(sessions).values({ orgId: s.orgId, userId: s.users.caregiver.id, tokenHash: "t-staff-edit", mfaPassed: true, expiresAt: new Date(Date.now() + 3_600_000) });
    const r = await inOrg((tx) => updateStaff(tx, owner, s.users.caregiver.id, { role: "caregiver", facilityIds: both() }));
    expect(r.ok && r.message).toMatch(/is now Caregiver/);
    const [u] = await db.select().from(users).where(eq(users.id, s.users.caregiver.id));
    expect(u.role).toBe("caregiver");
    const [sess] = await db.select().from(sessions).where(eq(sessions.tokenHash, "t-staff-edit"));
    expect(sess.revokedAt).not.toBeNull();
    // Put the demo caregiver back for the other tests.
    await inOrg((tx) => updateStaff(tx, owner, s.users.caregiver.id, { role: "med_caregiver", facilityIds: both() }));
  });

  it("won't give roles that aren't offered, demote the last owner, or let people change themselves", async () => {
    expect((await inOrg((tx) => updateStaff(tx, owner, s.users.caregiver.id, { role: "nurse", facilityIds: both() }))).ok).toBe(false);
    expect((await inOrg((tx) => updateStaff(tx, owner, s.users.owner.id, { role: "admin", facilityIds: both() }))).ok).toBe(false);
    // Another owner, then try to demote the original: allowed only while another active owner remains.
    await inOrg((tx) => inviteStaff(tx, owner, s.orgId, { name: "Second Owner", email: "second.owner@harborviewliving.test", role: "owner", facilityIds: both() }, "https://app.example.test"));
    const [second] = await db.select().from(users).where(eq(users.email, "second.owner@harborviewliving.test"));
    const secondActor: Actor = { id: second.id, role: "owner", facilityIds: both() };
    const lastOwner = await inOrg((tx) => updateStaff(tx, secondActor, s.users.owner.id, { role: "admin", facilityIds: both() }));
    expect(!lastOwner.ok && lastOwner.error).toMatch(/last owner/); // the second owner is only invited, not active
  });
});

describe("as-needed follow-ups", () => {
  it("adds the follow-up result to the resident's progress notes", async () => {
    const dose = await inOrg((tx) =>
      recordPrnDose(tx, medCaregiver, { orderId: c.orders.acetaminophen, residentCode: c.residents.diego.wristbandCode, packageConfirmed: true, reason: "Headache" }, at("10:00", "2026-10-18")),
    );
    expect(dose.ok).toBe(true);
    const [f] = await db.select().from(prnFollowups).where(eq(prnFollowups.residentId, c.residents.diego.id));
    const r = await inOrg((tx) => recordFollowup(tx, medCaregiver, { followupId: f.id, result: "partly_effective", note: "Still a mild headache" }, at("11:05", "2026-10-18")));
    expect(r.ok && r.message).toMatch(/progress notes/);
    const notes = await db.select().from(progressNotes).where(eq(progressNotes.residentId, c.residents.diego.id));
    const note = notes.find((n) => n.body.startsWith("As-needed Acetaminophen"));
    expect(note?.body).toBe("As-needed Acetaminophen 500 mg tablet given at 10:00 for headache: partly effective. Still a mild headache");
    expect(note).toMatchObject({ shift: "day", category: "health", recordedBy: s.users.caregiver.id });
  });
});

describe("timesheets", () => {
  it("lists shifts with hours and totals, flags missing sign-outs, and exports a safe spreadsheet", async () => {
    const cg = s.users.caregiver.id;
    await db.insert(shiftPunches).values([
      { orgId: s.orgId, userId: cg, facilityId: s.facilities.cedarRidge, signedInAt: at("07:00", "2026-10-12"), signedOutAt: at("15:30", "2026-10-12") },
      { orgId: s.orgId, userId: cg, facilityId: s.facilities.cedarRidge, signedInAt: at("23:00", "2026-10-13"), signedOutAt: at("07:15", "2026-10-14") },
      { orgId: s.orgId, userId: s.users.manager.id, facilityId: s.facilities.cedarRidge, signedInAt: at("08:00", "2026-10-15") },
      { orgId: s.orgId, userId: cg, facilityId: s.facilities.cedarRidge, signedInAt: at("07:00", "2026-10-20") },
    ]);
    const now = at("12:00", "2026-10-20");
    const t = (await inOrg((tx) => timesheet(tx, owner, { from: "2026-10-12", to: "2026-10-18" }, now)))!;
    const andre = t.people.find((p) => p.userId === cg)!;
    expect(andre).toMatchObject({ shifts: 2, hours: 16.75, problems: 0 });
    const night = t.shifts.find((x) => x.date === "2026-10-13")!;
    expect(night).toMatchObject({ signedIn: "23:00", signedOut: "07:15 (+1 day)", hours: 8.25 });
    const daniel = t.people.find((p) => p.userId === s.users.manager.id)!;
    expect(daniel).toMatchObject({ shifts: 1, hours: 0, problems: 1 });
    // The 20th is outside the range.
    expect(t.shifts.some((x) => x.date === "2026-10-20")).toBe(false);

    const csv = timesheetCsv(t);
    expect(csv.split("\r\n")[0]).toBe('"Name","Home","Date","Signed in","Signed out","Hours","Note"');
    expect(csv).toContain('"No sign-out"');

    expect(await inOrg((tx) => timesheet(tx, medCaregiver, { from: "2026-10-12", to: "2026-10-18" }, now))).toBeNull();
    expect(await inOrg((tx) => timesheet(tx, owner, { from: "2026-10-18", to: "2026-10-12" }, now))).toBeNull();
    expect(await inOrg((tx) => timesheet(tx, owner, { from: "2026-01-01", to: "2026-10-18" }, now))).toBeNull();
  });

  it("neutralises spreadsheet formulas in names", () => {
    const csv = timesheetCsv({
      from: "2026-10-12",
      to: "2026-10-18",
      shifts: [{ id: "1", userId: "u", name: "=HYPERLINK(\"x\")", role: "caregiver", home: "Cedar Ridge", date: "2026-10-12", signedIn: "07:00", signedOut: "15:00", hours: 8, status: "complete" }],
      people: [],
    });
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });
});
