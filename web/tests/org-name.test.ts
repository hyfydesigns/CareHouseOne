import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb, withTenant } from "@/db/client";
import { auditLog, organizations } from "@/db/schema";
import { setOrgName } from "@/server/org";
import { seedDemo } from "@/server/seed";

describe("organization name", () => {
  it("is changed by owners only, and the change is audited", async () => {
    const db = await createTestDb();
    const s = await seedDemo(db);
    const owner = { id: s.users.owner.id, role: "owner" as const, facilityIds: [] };
    const admin = { id: s.users.owner.id, role: "admin" as const, facilityIds: [] };
    const run = (actor: typeof owner | typeof admin, name: unknown) => withTenant(db, s.orgId, (tx) => setOrgName(tx, actor, s.orgId, name));
    expect((await run(admin, "Someone Else LLC")).ok).toBe(false);
    expect((await run(owner, " ")).ok).toBe(false);
    expect((await run(owner, "  Amazed Group Care LLC ")).ok).toBe(true);
    const [org] = await db.select().from(organizations).where(eq(organizations.id, s.orgId));
    expect(org.name).toBe("Amazed Group Care LLC");
    const log = await db.select().from(auditLog).where(eq(auditLog.orgId, s.orgId));
    expect(log.some((e) => e.action === "setting_changed" && (e.details as { setting?: string }).setting === "name")).toBe(true);
  });
});
