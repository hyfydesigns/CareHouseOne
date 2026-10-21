import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { handoffNotes, outbox, staffCertifications } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { appointmentFollowUps, recordAppointmentOutcome, rescheduleAppointment, residentAppointments, scheduleAppointment, upcomingAppointments } from "@/server/appointments";
import { addHandoff, overdueSafety, recentHandoffs, recordSafetyCheck, safetyStatus } from "@/server/operations";
import { deleteResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";
import { addCertification, certStatus, medCertExpired, remindCertifications, removeCertification, trainingOverview } from "@/server/training";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const now = new Date("2026-10-21T18:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("shift handoff notes", () => {
  it("are left by anyone at the home, shown to the next shift, and permanent", async () => {
    expect((await inOrg((tx) => addHandoff(tx, caregiver, s.orgId, { facilityId: s.facilities.mapleHouse, body: "Not my home" }, now))).ok).toBe(false);
    expect((await inOrg((tx) => addHandoff(tx, caregiver, s.orgId, { facilityId: s.facilities.cedarRidge, body: "" }, now))).ok).toBe(false);
    expect((await inOrg((tx) => addHandoff(tx, caregiver, s.orgId, { facilityId: s.facilities.cedarRidge, body: "Van needs gas." }, now))).ok).toBe(true);
    const notes = await inOrg((tx) => recentHandoffs(tx, caregiver, s.facilities.cedarRidge, new Date(now.getTime() + 3_600_000)));
    expect(notes[0].n).toMatchObject({ body: "Van needs gas.", shift: "day" }); // 2 PM Eastern
    expect(await inOrg((tx) => recentHandoffs(tx, caregiver, s.facilities.cedarRidge, new Date(now.getTime() + 20 * 3_600_000)))).toEqual([]);
    await expect(inOrg((tx) => tx.update(handoffNotes).set({ body: "changed" }))).rejects.toThrow();
  });
});

describe("fire drills and safety checks", () => {
  it("records checks and works out what's due, including shifts without a recent drill", async () => {
    const before = await inOrg((tx) => safetyStatus(tx, owner, s.facilities.cedarRidge, now));
    expect(before.every((x) => x.overdue)).toBe(true);
    const drill = (date: string, time: string) =>
      inOrg((tx) => recordSafetyCheck(tx, caregiver, s.orgId, { facilityId: s.facilities.cedarRidge, kind: "fire_drill", date, time, participants: "4", durationMinutes: "3" }, now));
    expect((await drill("2026-10-22", "10:00")).ok).toBe(false); // in the future
    expect((await drill("2026-10-20", "10:00")).ok).toBe(true);
    expect((await drill("2026-09-15", "19:30")).ok).toBe(true);
    const after = await inOrg((tx) => safetyStatus(tx, owner, s.facilities.cedarRidge, now));
    const fire = after.find((x) => x.kind === "fire_drill")!;
    expect(fire.overdue).toBe(false);
    expect(fire.shiftsMissing).toEqual(["night"]);
    expect(after.find((x) => x.kind === "smoke_detectors")?.overdue).toBe(true);
    const dash = await inOrg((tx) => overdueSafety(tx, owner, [{ id: s.facilities.cedarRidge, name: "Cedar Ridge" }], now));
    expect(dash[0].overdue).not.toContain("Fire drill");
    expect(await inOrg((tx) => overdueSafety(tx, caregiver, [{ id: s.facilities.cedarRidge, name: "Cedar Ridge" }], now))).toEqual([]);
  });
});

describe("appointments", () => {
  it("are scheduled by owners, recorded by whoever went, with follow-ups for the owner", async () => {
    const lena = c.residents.lena.id;
    const appt = { date: "2026-10-22", time: "09:30", provider: "Dr. Patel, family doctor", purpose: "Blood pressure follow-up" };
    expect((await inOrg((tx) => scheduleAppointment(tx, caregiver, lena, appt))).ok).toBe(false);
    expect((await inOrg((tx) => scheduleAppointment(tx, owner, lena, { ...appt, provider: "" }))).ok).toBe(false);
    expect((await inOrg((tx) => scheduleAppointment(tx, owner, lena, appt))).ok).toBe(true);
    const [{ a }] = await inOrg((tx) => residentAppointments(tx, lena));
    expect(a.scheduledAt.toISOString()).toBe("2026-10-22T13:30:00.000Z");
    expect((await inOrg((tx) => rescheduleAppointment(tx, owner, a.id, { ...appt, time: "10:00" }))).ok).toBe(true);
    const soon = await inOrg((tx) => upcomingAppointments(tx, owner, [s.facilities.cedarRidge], now));
    expect(soon.map((x) => x.a.id)).toContain(a.id);

    expect((await inOrg((tx) => recordAppointmentOutcome(tx, caregiver, a.id, { status: "done" }))).ok).toBe(false);
    const done = await inOrg((tx) => recordAppointmentOutcome(tx, caregiver, a.id, { status: "done", outcome: "BP 138/84. Keep same dose.", followUp: "Recheck in 3 months." }));
    expect(done.ok).toBe(true);
    expect((await inOrg((tx) => recordAppointmentOutcome(tx, caregiver, a.id, { status: "missed", outcome: "x" }))).ok).toBe(false);
    const fu = await inOrg((tx) => appointmentFollowUps(tx, owner, new Date("2026-10-23T12:00:00Z")));
    expect(fu.map((x) => x.a.followUp)).toContain("Recheck in 3 months.");
    // A resident with appointments has records, so can't be deleted as a mistake.
    expect((await inOrg((tx) => deleteResident(tx, owner, lena, { reason: "test" }))).ok).toBe(false);
  });
});

describe("training and certifications", () => {
  it("tracks expiry, warns about an expired medication certification, and emails reminders once", async () => {
    expect(certStatus(null, "2026-10-21")).toBe("no_expiry");
    expect(certStatus("2026-10-20", "2026-10-21")).toBe("expired");
    expect(certStatus("2026-11-10", "2026-10-21")).toBe("expiring");
    expect(certStatus("2027-03-01", "2026-10-21")).toBe("current");

    const andre = s.users.caregiver.id;
    expect((await inOrg((tx) => addCertification(tx, caregiver, s.orgId, { userId: andre, kind: "cpr" }))).ok).toBe(false);
    expect((await inOrg((tx) => addCertification(tx, owner, s.orgId, { userId: andre, kind: "cpr", issuedOn: "2026-05-01", expiresOn: "2026-01-01" }))).ok).toBe(false);
    expect((await inOrg((tx) => addCertification(tx, owner, s.orgId, { userId: andre, kind: "other" }))).ok).toBe(false);
    expect((await inOrg((tx) => addCertification(tx, owner, s.orgId, { userId: andre, kind: "med_cert", issuedOn: "2024-10-01", expiresOn: "2026-10-01" }))).ok).toBe(true);
    expect((await inOrg((tx) => addCertification(tx, owner, s.orgId, { userId: andre, kind: "cpr", expiresOn: "2026-11-05" }))).ok).toBe(true);
    expect(await inOrg((tx) => medCertExpired(tx, andre, "2026-10-21"))).toBe(true);

    const overview = await inOrg((tx) => trainingOverview(tx, "2026-10-21"));
    expect(overview.find((p) => p.id === andre)?.worst).toBe("expired");

    expect(await remindCertifications(db, now)).toBe(2);
    expect(await remindCertifications(db, now)).toBe(0);
    const mail = await db.select().from(outbox).where(eq(outbox.subject, "Andre Thomas's Medication administration certification has expired"));
    expect(mail.map((m) => m.to)).toEqual(expect.arrayContaining([s.users.caregiver.email, s.users.owner.email]));
    expect(mail[0].body).toMatch(/shouldn't give medications/);

    // A renewal replaces it.
    expect((await inOrg((tx) => addCertification(tx, owner, s.orgId, { userId: andre, kind: "med_cert", issuedOn: "2026-10-15", expiresOn: "2028-10-15" }))).ok).toBe(true);
    expect(await inOrg((tx) => medCertExpired(tx, andre, "2026-10-21"))).toBe(false);
    const [old] = await db.select().from(staffCertifications).where(eq(staffCertifications.expiresOn, "2026-10-01"));
    expect((await inOrg((tx) => removeCertification(tx, owner, old.id))).ok).toBe(true);
    expect((await inOrg((tx) => removeCertification(tx, owner, old.id))).ok).toBe(false);
  });
});
