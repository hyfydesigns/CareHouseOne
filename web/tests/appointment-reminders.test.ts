import { eq, like } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { organizations, outbox } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { appointmentsSoon, remindAppointments, scheduleAppointment } from "@/server/appointments";
import { setAppointmentReminders } from "@/server/org";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
// The seeded homes are on Eastern time (EST after Nov 1): 18:00 UTC is 1 PM, 23:30 UTC is 6:30 PM.
const afternoon = new Date("2026-11-02T18:00:00Z");
const evening = new Date("2026-11-02T23:30:00Z");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  const appt = { provider: "Dr. Chen, neurology", purpose: "Seizure medication review", location: "Riverside Clinic" };
  for (const [date, time] of [["2026-11-03", "10:00"], ["2026-11-03", "14:30"], ["2026-11-02", "15:30"]]) {
    const r = await inOrg((tx) => scheduleAppointment(tx, owner, c.residents.lena.id, { ...appt, date, time }));
    if (!r.ok) throw new Error(r.error);
  }
});

const digests = () => db.select().from(outbox).where(like(outbox.subject, "%appointment%"));

describe("appointment reminders", () => {
  it("emails owners and admins once in the evening with counts only, no names or reasons", async () => {
    expect(await remindAppointments(db, afternoon)).toBe(0); // too early in the day
    expect(await remindAppointments(db, evening)).toBe(1);
    expect(await remindAppointments(db, new Date(evening.getTime() + 600_000))).toBe(0); // already sent
    const mail = await digests();
    expect(mail.length).toBeGreaterThan(0);
    expect(mail[0].subject).toBe("Tomorrow: 2 appointments at your homes");
    expect(mail[0].body).toContain("Cedar Ridge: 2 appointments");
    expect(mail[0].body).not.toMatch(/Lena|Chen|Seizure|Riverside/);
  });

  it("can be moved to the morning or turned off, by owners and admins only", async () => {
    expect((await inOrg((tx) => setAppointmentReminders(tx, caregiver, s.orgId, "off"))).ok).toBe(false);
    expect((await inOrg((tx) => setAppointmentReminders(tx, owner, s.orgId, "sometimes"))).ok).toBe(false);
    expect((await inOrg((tx) => setAppointmentReminders(tx, owner, s.orgId, "morning"))).ok).toBe(true);
    // Tomorrow's were already in last night's email, so the morning doesn't repeat them.
    expect(await remindAppointments(db, new Date("2026-11-03T12:00:00Z"))).toBe(0);
    await db.update(organizations).set({ appointmentDigestOn: null }).where(eq(organizations.id, s.orgId));
    expect(await remindAppointments(db, new Date("2026-11-03T12:00:00Z"))).toBe(1); // 7 AM Eastern
    expect((await inOrg((tx) => setAppointmentReminders(tx, owner, s.orgId, "off"))).ok).toBe(true);
    await db.update(organizations).set({ appointmentDigestOn: null }).where(eq(organizations.id, s.orgId));
    expect(await remindAppointments(db, new Date("2026-11-03T12:00:00Z"))).toBe(0);
  });

  it("shows the tablet what's coming up in the next 3 hours at its home", async () => {
    const soon = await inOrg((tx) => appointmentsSoon(tx, caregiver, [s.facilities.cedarRidge], afternoon)); // 1 PM Eastern
    expect(soon.map((x) => x.a.purpose)).toEqual(["Seizure medication review"]);
    expect(await inOrg((tx) => appointmentsSoon(tx, caregiver, [s.facilities.mapleHouse], afternoon))).toEqual([]);
    expect(await inOrg((tx) => appointmentsSoon(tx, caregiver, [s.facilities.cedarRidge], new Date("2026-11-02T14:00:00Z")))).toEqual([]);
  });
});
