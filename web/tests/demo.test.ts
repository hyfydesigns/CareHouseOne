import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { administrations, appointments, incidents, organizations, outbox, residents } from "@/db/schema";
import { demoSignIn, getSessionUser } from "@/server/auth";
import { DEMO_ROLES, demoIsStale, registerDemoTablet, resetDemo, seedDemoIfEmpty } from "@/server/demo";
import { deliverOutbox } from "@/server/mailer";

let db: DB;
const now = new Date("2026-10-21T16:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the public demo", () => {
  it("only runs with DEMO_MODE on, and on a real database only if its name says demo", async () => {
    await expect(resetDemo(db, now)).rejects.toThrow(/Not the demo app/);
    vi.stubEnv("DEMO_MODE", "true");
    vi.stubEnv("DATABASE_URL", "postgresql://user@localhost/carehouse");
    await expect(seedDemoIfEmpty(db, now)).rejects.toThrow(/name must contain "demo"/);
    await expect(resetDemo(db, now)).rejects.toThrow(/name must contain "demo"/);
    await expect(demoSignIn(db, DEMO_ROLES.owner.email, null)).rejects.toThrow(/demo account/);
    vi.unstubAllEnvs();
    await expect(demoSignIn(db, DEMO_ROLES.owner.email, null)).rejects.toThrow(/Not the demo app/);
  });

  it("fills a realistic day of made-up data around today, and resets it", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await resetDemo(db, now, { skipDatabaseCheck: true });
    const [org] = await db.select().from(organizations);
    expect(org.name).toBe("Harborview Community Living");
    expect((await db.select().from(residents)).length).toBe(4);
    expect((await db.select().from(administrations)).length).toBeGreaterThan(50);
    expect((await db.select().from(incidents)).length).toBe(2);
    expect((await db.select().from(appointments)).length).toBe(3);
    expect(await demoIsStale(db, new Date(Date.now() + 3_600_000))).toBe(false);
    expect(await demoIsStale(db, new Date(Date.now() + 13 * 3_600_000))).toBe(true);

    // Whatever visitors add is gone after the nightly reset.
    const [lena] = await db.select().from(residents).where(eq(residents.firstName, "Lena"));
    await withTenant(db, org.id, (tx) => tx.insert(residents).values({ orgId: org.id, facilityId: lena.facilityId, firstName: "Visitor", lastName: "Added", wristbandCode: "R-VISITOR1" }));
    expect((await db.select().from(residents)).length).toBe(5);
    await resetDemo(db, new Date(now.getTime() + 86_400_000), { skipDatabaseCheck: true });
    expect((await db.select().from(organizations)).length).toBe(1);
    expect((await db.select().from(residents)).map((r) => r.firstName).sort()).toEqual(["Ben", "Diego", "Lena", "Marcus"]);
  });

  it("signs visitors straight in, and the caregiver on a demo tablet", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    const owner = await demoSignIn(db, DEMO_ROLES.owner.email, null);
    expect((await getSessionUser(db, owner.token))?.role).toBe("owner");
    const tablet = await registerDemoTablet(db);
    const cg = await demoSignIn(db, DEMO_ROLES.caregiver.email, tablet.id);
    const me = await getSessionUser(db, cg.token);
    expect(me?.role).toBe("med_caregiver");
    expect(me?.device?.id).toBe(tablet.id);
    expect(me?.needsPin).toBe(true);
    await expect(demoSignIn(db, "someone@example.com", null)).rejects.toThrow();
  });

  it("never sends email", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    await db.insert(outbox).values({ orgId: null, to: "a@b.test", subject: "x", body: "y" });
    const sent: string[] = [];
    const r = await deliverOutbox(db, { send: async (m) => void sent.push(m.to) });
    expect(r.sent).toBe(0);
    expect(sent).toEqual([]);
    const [row] = await db.select().from(outbox).where(eq(outbox.to, "a@b.test"));
    expect(row.sentAt).toBeNull();
  });
});
