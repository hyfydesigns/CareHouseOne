import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, incidents, outbox } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { addIncidentFollowup, fileIncident, getIncident, listIncidents, openIncidentCount } from "@/server/incidents";
import { deleteResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

const APP = "https://app.example.test";
let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
let other: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const now = new Date("2026-10-21T18:00:00Z");

const report = (over: Record<string, unknown> = {}) => ({
  facilityId: s.facilities.cedarRidge,
  residentId: c.residents.lena.id,
  type: "fall",
  severity: "moderate",
  date: "2026-10-21",
  time: "09:30",
  location: "Bathroom",
  description: "Found Lena sitting on the bathroom floor next to the sink.",
  actionTaken: "Checked for injuries, helped her up with a second staff member.",
  injury: "yes",
  injuryDetails: "Small bruise on left elbow.",
  witnesses: "",
  ...over,
});

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  other = { id: s.users.nurse.id, role: "caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("incident reports", () => {
  let id: string;

  it("lets a caregiver file a report, emails owners and admins without details, and keeps it permanent", async () => {
    const bad = await inOrg((tx) => fileIncident(tx, caregiver, s.orgId, report({ description: "fell" }), APP, now));
    expect(!bad.ok && bad.error).toMatch(/Describe what happened/);
    const noInjury = await inOrg((tx) => fileIncident(tx, caregiver, s.orgId, report({ injuryDetails: "" }), APP, now));
    expect(!noInjury.ok && noInjury.error).toMatch(/Describe the injury/);
    const future = await inOrg((tx) => fileIncident(tx, caregiver, s.orgId, report({ time: "23:00" }), APP, now));
    expect(!future.ok && future.error).toMatch(/future/);
    const wrongHome = await inOrg((tx) => fileIncident(tx, caregiver, s.orgId, report({ facilityId: s.facilities.mapleHouse, residentId: "" }), APP, now));
    expect(wrongHome.ok).toBe(false);
    const mismatched = await inOrg((tx) => fileIncident(tx, owner, s.orgId, report({ residentId: c.residents.ben.id }), APP, now));
    expect(!mismatched.ok && mismatched.error).toMatch(/doesn't live at that home/);

    const r = await inOrg((tx) => fileIncident(tx, caregiver, s.orgId, report(), APP, now));
    if (!r.ok) throw new Error(r.error);
    id = r.data!.id;
    const mail = await db.select().from(outbox).where(eq(outbox.subject, "New moderate incident report at Cedar Ridge"));
    expect(mail.length).toBeGreaterThan(0);
    expect(mail[0].body).toContain(`/incidents/${id}`);
    expect(mail[0].body).not.toMatch(/Lena|bruise|bathroom/i);
    // Permanent: the app's database role can't change or delete it.
    await expect(inOrg((tx) => tx.update(incidents).set({ description: "changed" }).where(eq(incidents.id, id)))).rejects.toThrow();
    await expect(inOrg((tx) => tx.delete(incidents).where(eq(incidents.id, id)))).rejects.toThrow();
    // And Lena can't be deleted as "added by mistake" any more.
    expect((await inOrg((tx) => deleteResident(tx, owner, c.residents.lena.id, { reason: "test" }))).ok).toBe(false);
  });

  it("shows owners every report and caregivers only their own", async () => {
    expect((await inOrg((tx) => listIncidents(tx, owner))).map((r) => r.i.id)).toContain(id);
    expect((await inOrg((tx) => listIncidents(tx, caregiver))).map((r) => r.i.id)).toEqual([id]);
    expect(await inOrg((tx) => listIncidents(tx, other))).toEqual([]);
    expect(await inOrg((tx) => getIncident(tx, other, id))).toBeNull();
    expect(await inOrg((tx) => openIncidentCount(tx, owner))).toBe(1);
  });

  it("lets owners record notifications and close it with an outcome; caregivers can't", async () => {
    expect((await inOrg((tx) => addIncidentFollowup(tx, caregiver, id, { kind: "note", details: "x" }, now))).ok).toBe(false);
    expect((await inOrg((tx) => addIncidentFollowup(tx, owner, id, { kind: "guardian_notified", details: "Called Sam Kim at 10:15." }, now))).ok).toBe(true);
    const noOutcome = await inOrg((tx) => addIncidentFollowup(tx, owner, id, { kind: "closed" }, now));
    expect(!noOutcome.ok && noOutcome.error).toMatch(/outcome/);
    expect((await inOrg((tx) => addIncidentFollowup(tx, owner, id, { kind: "closed", details: "Grab bar installed." }, new Date(now.getTime() + 60_000)))).ok).toBe(true);
    const inc = await inOrg((tx) => getIncident(tx, owner, id));
    expect(inc?.open).toBe(false);
    expect(inc?.notified.guardian).not.toBeNull();
    expect(await inOrg((tx) => openIncidentCount(tx, owner))).toBe(0);
    expect((await inOrg((tx) => addIncidentFollowup(tx, owner, id, { kind: "closed", details: "again" }, now))).ok).toBe(false);
    expect((await inOrg((tx) => addIncidentFollowup(tx, owner, id, { kind: "reopened", details: "Second fall the next day." }, new Date(now.getTime() + 120_000)))).ok).toBe(true);
    expect((await inOrg((tx) => getIncident(tx, owner, id)))?.open).toBe(true);
    const logs = await db.select().from(auditLog).where(eq(auditLog.entityId, id));
    expect(logs.map((l) => l.action)).toEqual(expect.arrayContaining(["incident_filed", "incident_guardian_notified", "incident_closed", "incident_reopened"]));
  });
});
