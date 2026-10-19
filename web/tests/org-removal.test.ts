import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, type DB } from "@/db/client";
import { auditLog, organizations, users } from "@/db/schema";
import { audit } from "@/server/audit";
import { provisionOrganization } from "@/server/provision";
import { listOrganizations, removeTestOrganization } from "@/server/org-removal";
import { seedCare, seedDemo, type Seeded } from "@/server/seed";

let db: DB;
let demo: Seeded;
let testOrgId: string;

beforeAll(async () => {
  db = await createTestDb();
  demo = await seedDemo(db);
  await seedCare(db, demo);
  const r = await provisionOrganization(
    db,
    { orgName: "Sandbox Test Homes", homes: [{ name: "Test House", timeZone: "America/Chicago" }], owner: { name: "Test Owner", email: "owner@sandbox.test" } },
    "https://app.example.test",
  );
  testOrgId = r.orgId;
});

describe("removing test organizations", () => {
  it("lists organizations with their owners and resident counts", async () => {
    const list = await listOrganizations(db);
    const t = list.find((o) => o.id === testOrgId)!;
    expect(t).toMatchObject({ name: "Sandbox Test Homes", owners: ["owner@sandbox.test"], homes: 1, residents: 0 });
    expect(list.find((o) => o.id === demo.orgId)!.residents).toBeGreaterThan(0);
  });

  it("needs the exact name", async () => {
    const r = await removeTestOrganization(db, testOrgId, "sandbox test homes");
    expect(!r.ok && r.error).toMatch(/doesn't match/);
  });

  it("refuses an organization with care records", async () => {
    const [org] = await db.select().from(organizations).where(eq(organizations.id, demo.orgId));
    const r = await removeTestOrganization(db, demo.orgId, org.name);
    expect(!r.ok && r.error).toMatch(/care records/);
  });

  it("removes a test organization completely and leaves the audit log locked", async () => {
    await audit(db, { orgId: demo.orgId, actorId: null, action: "kept", entity: "organization", entityId: demo.orgId });
    const r = await removeTestOrganization(db, testOrgId, "Sandbox Test Homes");
    expect(r.ok).toBe(true);
    expect(await db.select().from(organizations).where(eq(organizations.id, testOrgId))).toHaveLength(0);
    expect(await db.select().from(users).where(eq(users.orgId, testOrgId))).toHaveLength(0);
    expect(await db.select().from(auditLog).where(eq(auditLog.orgId, testOrgId))).toHaveLength(0);
    // Other organizations' audit logs are untouched and still can't be changed.
    const left = await db.select().from(auditLog).where(eq(auditLog.orgId, demo.orgId));
    expect(left.length).toBeGreaterThan(0);
    const blocked = await db.execute(sql`delete from audit_log`).then(
      () => "deleted",
      (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message,
    );
    expect(blocked).toMatch(/append-only/);
  });
});
