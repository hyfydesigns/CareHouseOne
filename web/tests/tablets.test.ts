import { and, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, devicePins, progressNotes, sessions, vitals } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { currentTotp } from "@/lib/totp";
import { getSessionUser, signIn, signOut, verifyMfa, DEVICE_LOCK_MINUTES } from "@/server/auth";
import { signInShift, signOutShift } from "@/server/care";
import { homeSummaries } from "@/server/dashboard";
import { checkPin, listDevices, lockSession, registerDevice, resolveDevice, revokeDevice, setPin, unlockWithPin, updateDeviceHomes } from "@/server/devices";
import { DEMO_PASSWORD, seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";
import { syncEntries } from "@/server/sync";

let db: DB;
let s: Seeded;
let c: SeededCare;
let other: Seeded;
let owner: Actor;
let caregiver: Actor;
let tabletToken: string;
let tabletId: string;

const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2], orgId = s.orgId) => withTenant(db, orgId, fn);

async function signInOn(user: { email: string; totpSecret: string }, deviceId: string | null) {
  const r = await signIn(db, { email: user.email, password: DEMO_PASSWORD, deviceId });
  if (!r.ok) throw new Error(r.error);
  if (r.next === "done") return r.token; // a caregiver on their home's tablet: no two-step code
  const v = await verifyMfa(db, r.token, await currentTotp(user.totpSecret));
  if (!v.ok) throw new Error(v.error);
  return r.token;
}
const me = async (token: string) => (await getSessionUser(db, token))!;
const idleFor = (token: string, minutes: number) =>
  db.update(sessions).set({ lastSeenAt: new Date(Date.now() - minutes * 60_000) }).where(eq(sessions.id, sessionIdOf(token)));
const sessionIds = new Map<string, string>();
const sessionIdOf = (token: string) => sessionIds.get(token)!;
async function track(token: string) {
  sessionIds.set(token, (await me(token)).sessionId);
  return token;
}

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  const r = await inOrg((tx) => registerDevice(tx, owner, s.orgId, { facilityIds: [s.facilities.cedarRidge], name: "Cedar Ridge med room" }));
  if (!r.ok) throw new Error(r.error);
  tabletToken = r.data!.token;
  tabletId = (await resolveDevice(db, tabletToken))!.id;
});

describe("registering tablets", () => {
  it("is for owners and admins, and checks the name", async () => {
    const no = await inOrg((tx) => registerDevice(tx, caregiver, s.orgId, { facilityIds: [s.facilities.cedarRidge], name: "Mine" }));
    expect(!no.ok && no.error).toMatch(/can't register/);
    const bad = await inOrg((tx) => registerDevice(tx, owner, s.orgId, { facilityIds: [s.facilities.cedarRidge], name: "x" }));
    expect(bad.ok).toBe(false);
    expect((await inOrg((tx) => listDevices(tx, owner))).map((r) => r.d.name)).toEqual(["Cedar Ridge med room"]);
  });

  it("can't be seen from another organization", async () => {
    const otherOwner: Actor = { id: other.users.owner.id, role: "owner", facilityIds: [other.facilities.cedarRidge] };
    expect(await inOrg((tx) => listDevices(tx, otherOwner), other.orgId)).toEqual([]);
  });

  it("ignores a tablet from another organization at sign-in", async () => {
    const token = await signInOn(other.users.caregiver, tabletId);
    const u = await me(token);
    expect(u.device).toBeNull();
    expect(u.needsPin).toBe(false);
  });
});

describe("who needs two-step verification", () => {
  const signInRaw = (email: string, deviceId: string | null) => signIn(db, { email, password: DEMO_PASSWORD, deviceId });

  it("lets caregivers sign in on their own home's tablet with just a password", async () => {
    const r = await signInRaw(s.users.caregiver.email, tabletId);
    expect(r.ok && r.next).toBe("done");
    if (!r.ok) return;
    expect((await me(r.token)).needsPin).toBe(true);
    const logged = await db.select().from(auditLog).where(and(eq(auditLog.action, "sign_in_tablet"), eq(auditLog.actorId, s.users.caregiver.id)));
    expect(logged.length).toBeGreaterThan(0);
  });

  it("still asks everyone else, and caregivers anywhere else, for a code", async () => {
    // A nurse on the same tablet.
    const nurse = await signInRaw(s.users.nurse.email, tabletId);
    expect(nurse.ok && nurse.next).toBe("mfa");
    // The caregiver on an ordinary browser (they have two-step set up from the demo seed).
    const away = await signInRaw(s.users.caregiver.email, null);
    expect(away.ok && away.next).toBe("mfa");
    // The caregiver on a tablet registered to a home they don't work at.
    const r = await inOrg((tx) => registerDevice(tx, owner, s.orgId, { facilityIds: [s.facilities.mapleHouse], name: "Maple House office" }));
    const maple = (await resolveDevice(db, r.ok ? r.data!.token : ""))!.id;
    const elsewhere = await signInRaw(s.users.caregiver.email, maple);
    expect(elsewhere.ok && elsewhere.next).toBe("mfa");
    // A removed tablet counts as an ordinary browser.
    await inOrg((tx) => revokeDevice(tx, owner, maple));
    const removed = await signInRaw(s.users.caregiver.email, maple);
    expect(removed.ok && removed.next).toBe("mfa");
  });
});

describe("PIN and auto-lock on a shared tablet", () => {
  it("asks for a PIN after sign-in and refuses easy ones", async () => {
    const token = await track(await signInOn(s.users.caregiver, tabletId));
    const u = await me(token);
    expect(u.device?.facilityIds).toEqual([s.facilities.cedarRidge]);
    expect(u.needsPin).toBe(true);
    expect(checkPin("1234")).toMatch(/in a row/);
    expect(checkPin("0000")).toMatch(/same digit/);
    expect(checkPin("12a4")).toMatch(/4 to 8 digits/);
    expect((await setPin(db, u, "2580", "2581")).ok).toBe(false);
    expect((await setPin(db, u, "2580", "2580")).ok).toBe(true);
    expect((await me(token)).needsPin).toBe(false);
  });

  it("locks when idle, unlocks with the PIN, and signs out after five wrong tries", async () => {
    const token = await track(await signInOn(s.users.caregiver, tabletId));
    const fresh = await me(token);
    expect(fresh.locked).toBe(false);

    await idleFor(token, DEVICE_LOCK_MINUTES + 1);
    const locked = await me(token);
    expect(locked.locked).toBe(true);

    const wrong = await unlockWithPin(db, locked, "9999");
    expect(!wrong.ok && wrong.error).toMatch(/4 tries left/);
    expect((await unlockWithPin(db, locked, "2580")).ok).toBe(true);
    expect((await me(token)).locked).toBe(false);

    await lockSession(db, await me(token));
    const again = await me(token);
    expect(again.locked).toBe(true);
    let last: Awaited<ReturnType<typeof unlockWithPin>> = { ok: true };
    for (let i = 0; i < 5; i++) last = await unlockWithPin(db, again, "1357");
    expect(!last.ok && last.signedOut).toBe(true);
    expect(await getSessionUser(db, token)).toBeNull();
    const pins = await db.select().from(devicePins).where(and(eq(devicePins.deviceId, tabletId), eq(devicePins.userId, s.users.caregiver.id)));
    expect(pins).toEqual([]);
  });

  it("doesn't sign a tablet out at the 15-minute idle limit, but does an ordinary browser", async () => {
    const tablet = await track(await signInOn(s.users.nurse, tabletId));
    const laptop = await track(await signInOn(s.users.nurse, null));
    await idleFor(tablet, 20);
    await idleFor(laptop, 20);
    expect((await me(tablet)).locked).toBe(true);
    expect(await getSessionUser(db, laptop)).toBeNull();
  });

  it("clears the PIN at sign-out", async () => {
    const token = await track(await signInOn(s.users.manager, tabletId));
    await setPin(db, await me(token), "4826", "4826");
    await signOut(db, token);
    const next = await signInOn(s.users.manager, tabletId);
    expect((await me(next)).needsPin).toBe(true);
  });
});

describe("shift sign-in needs the home's tablet", () => {
  it("refuses other browsers and records the tablet's home", async () => {
    const t = new Date("2026-10-16T11:00:00Z");
    const away = await inOrg((tx) => signInShift(tx, caregiver, s.orgId, null, null, t));
    expect(!away.ok && away.error).toMatch(/home's tablet/);
    const wrongHome = await inOrg((tx) => signInShift(tx, caregiver, s.orgId, [s.facilities.mapleHouse], null, t));
    expect(!wrongHome.ok && wrongHome.error).toMatch(/not assigned/);
    expect((await inOrg((tx) => signInShift(tx, caregiver, s.orgId, [s.facilities.cedarRidge], null, t))).ok).toBe(true);
    // Signing out works anywhere, so a forgotten sign-out never blocks the next shift.
    expect((await inOrg((tx) => signOutShift(tx, caregiver, new Date("2026-10-16T19:00:00Z")))).ok).toBe(true);
  });
});

describe("offline sync", () => {
  it("saves queued entries once, keeps when they were taken, and refuses the wrong person or stale entries", async () => {
    const token = await signInOn(s.users.caregiver, tabletId);
    const u = await me(token);
    const now = new Date();
    const takenAt = new Date(now.getTime() - 40 * 60_000);
    const vitalsId = crypto.randomUUID();
    const noteId = crypto.randomUUID();
    const items = [
      { clientId: vitalsId, kind: "vitals", userId: u.id, createdAt: takenAt.toISOString(), payload: { residentId: c.residents.lena.id, systolic: "126", diastolic: "78", pulse: "70" } },
      { clientId: noteId, kind: "note", userId: u.id, createdAt: takenAt.toISOString(), payload: { residentId: c.residents.lena.id, shift: "day", category: "general", body: "Ate lunch and walked in the garden." } },
      { clientId: crypto.randomUUID(), kind: "note", userId: s.users.nurse.id, createdAt: takenAt.toISOString(), payload: { residentId: c.residents.lena.id, shift: "day", category: "general", body: "Not mine." } },
      { clientId: crypto.randomUUID(), kind: "note", userId: u.id, createdAt: new Date(now.getTime() - 80 * 3_600_000).toISOString(), payload: { residentId: c.residents.lena.id, shift: "day", category: "general", body: "Too old." } },
      { clientId: crypto.randomUUID(), kind: "vitals", userId: u.id, createdAt: takenAt.toISOString(), payload: { residentId: c.residents.lena.id, systolic: "126" } },
      { kind: "nonsense" },
    ];
    const first = await syncEntries(db, u, items, now);
    expect(first.map((o) => o.status)).toEqual(["saved", "saved", "rejected", "rejected", "rejected", "rejected"]);
    expect(first[2].error).toMatch(/someone else/);
    expect(first[3].error).toMatch(/72 hours/);

    const again = await syncEntries(db, u, items.slice(0, 2), now);
    expect(again.map((o) => o.status)).toEqual(["duplicate", "duplicate"]);

    const [v] = await db.select().from(vitals).where(eq(vitals.clientId, vitalsId));
    expect(v.recordedAt.getTime()).toBe(takenAt.getTime());
    expect(await db.select().from(progressNotes).where(eq(progressNotes.clientId, noteId))).toHaveLength(1);
  });
});

describe("owner dashboard", () => {
  it("summarizes each home the person can see", async () => {
    const all = await inOrg((tx) => homeSummaries(tx, owner, new Date()));
    expect(all.map((h) => h.name)).toEqual(["Cedar Ridge", "Maple House"]);
    const cedar = all[0];
    expect(cedar.residents).toBeGreaterThan(0);
    expect(cedar.doses.total).toBe(cedar.doses.given + cedar.doses.refused + cedar.doses.held + cedar.doses.due + cedar.doses.late + cedar.doses.upcoming);
    expect(cedar.tablets.map((t) => t.name)).toEqual(["Cedar Ridge med room"]);
    expect(all[1].tablets).toEqual([]);

    const mine = await inOrg((tx) => homeSummaries(tx, caregiver, new Date()));
    expect(mine.map((h) => h.name)).toEqual(["Cedar Ridge"]);
  });
});

describe("removing a tablet", () => {
  it("signs out everyone on it and stops it being recognised", async () => {
    const token = await signInOn(s.users.nurse, tabletId);
    expect((await inOrg((tx) => revokeDevice(tx, caregiver, tabletId))).ok).toBe(false);
    expect((await inOrg((tx) => revokeDevice(tx, owner, tabletId))).ok).toBe(true);
    expect(await getSessionUser(db, token)).toBeNull();
    expect(await resolveDevice(db, tabletToken)).toBeNull();
  });
});

describe("a tablet used at more than one home", () => {
  it("lets caregivers of either home sign in, choose the home for their shift, and follows home changes", async () => {
    const r = await inOrg((tx) => registerDevice(tx, owner, s.orgId, { facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse], name: "Float tablet" }));
    if (!r.ok) throw new Error(r.error);
    const sharedId = (await resolveDevice(db, r.data!.token))!.id;
    const listed = (await inOrg((tx) => listDevices(tx, owner))).find((x) => x.d.id === sharedId);
    expect(listed?.homes.map((h) => h.id).sort()).toEqual([s.facilities.cedarRidge, s.facilities.mapleHouse].sort());
    // Both homes' dashboards show it.
    const homes = await inOrg((tx) => homeSummaries(tx, owner, new Date()));
    expect(homes.every((h) => h.tablets.some((t) => t.name === "Float tablet"))).toBe(true);

    // Andre works at Cedar Ridge only: signed straight in on the shared tablet.
    const token = await signInOn(s.users.caregiver, sharedId);
    expect((await me(token)).device?.facilityIds.sort()).toEqual([s.facilities.cedarRidge, s.facilities.mapleHouse].sort());

    // Someone filling in at both homes picks where they're working.
    const floater: Actor = { ...caregiver, facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
    const both = [s.facilities.cedarRidge, s.facilities.mapleHouse];
    const t = new Date("2026-10-17T11:00:00Z");
    const unchosen = await inOrg((tx) => signInShift(tx, floater, s.orgId, both, null, t));
    expect(!unchosen.ok && unchosen.error).toMatch(/Choose the home/);
    expect((await inOrg((tx) => signInShift(tx, caregiver, s.orgId, both, s.facilities.mapleHouse, t))).ok).toBe(false);
    expect((await inOrg((tx) => signInShift(tx, floater, s.orgId, both, s.facilities.mapleHouse, t))).ok).toBe(true);
    expect((await inOrg((tx) => signOutShift(tx, floater, new Date("2026-10-17T19:00:00Z")))).ok).toBe(true);

    // Only owners and admins change its homes; doing so signs everyone out of it.
    expect((await inOrg((tx) => updateDeviceHomes(tx, caregiver, sharedId, [s.facilities.cedarRidge]))).ok).toBe(false);
    expect((await inOrg((tx) => updateDeviceHomes(tx, owner, sharedId, []))).ok).toBe(false);
    expect((await inOrg((tx) => updateDeviceHomes(tx, owner, sharedId, [other.facilities.cedarRidge]))).ok).toBe(false);
    expect((await inOrg((tx) => updateDeviceHomes(tx, owner, sharedId, [s.facilities.mapleHouse]))).ok).toBe(true);
    expect(await getSessionUser(db, token)).toBeNull();
    // Now it's a Maple House tablet: Andre (Cedar Ridge) isn't signed in by the tablet any more.
    const again = await signIn(db, { email: s.users.caregiver.email, password: DEMO_PASSWORD, deviceId: sharedId });
    expect(again.ok && again.next).not.toBe("done");
  });
});
