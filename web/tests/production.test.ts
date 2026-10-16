import { eq } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type DB } from "@/db/client";
import { outbox, rateLimits } from "@/db/schema";
import { checkProductionConfig } from "@/lib/config";
import { sendMail } from "@/server/audit";
import { deliverOutbox, MAX_ATTEMPTS, type Transport } from "@/server/mailer";
import { hit, LIMITS, pruneRateLimits } from "@/server/rate-limit";

let db: DB;

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("rate limits", () => {
  it("allows the limit, refuses the next, and starts over after the window", async () => {
    const t0 = new Date("2026-10-16T12:00:00Z");
    const { limit, windowSeconds } = LIMITS.reset;
    for (let i = 0; i < limit; i++) expect((await hit(db, "reset", "203.0.113.7", t0)).ok).toBe(true);
    const blocked = await hit(db, "reset", "203.0.113.7", new Date(t0.getTime() + 60_000));
    expect(blocked.ok).toBe(false);
    expect(!blocked.ok && blocked.retryAfterMinutes).toBe(14);
    // Another address and another limit are counted separately.
    expect((await hit(db, "reset", "198.51.100.2", t0)).ok).toBe(true);
    expect((await hit(db, "signIn", "203.0.113.7", t0)).ok).toBe(true);
    const later = new Date(t0.getTime() + (windowSeconds + 1) * 1000);
    expect((await hit(db, "reset", "203.0.113.7", later)).ok).toBe(true);
  });

  it("stores addresses hashed and prunes old counters", async () => {
    const rows = await db.select().from(rateLimits);
    expect(rows.some((r) => r.key.includes("203.0.113.7"))).toBe(false);
    await pruneRateLimits(db, new Date("2026-10-18T12:00:00Z"));
    expect(await db.select().from(rateLimits)).toEqual([]);
  });
});

describe("email delivery", () => {
  it("sends queued mail once and retries failures up to a limit", async () => {
    await sendMail(db, { orgId: null, to: "a@example.test", subject: "Hello", body: "Link" });
    await sendMail(db, { orgId: null, to: "b@example.test", subject: "Hello", body: "Link" });
    const sent: string[] = [];
    const flaky: Transport = {
      async send(m) {
        if (m.to.startsWith("b")) throw new Error("mailbox unavailable");
        sent.push(m.to);
      },
    };
    expect(await deliverOutbox(db, flaky)).toEqual({ sent: 1, failed: 1 });
    expect(await deliverOutbox(db, flaky)).toEqual({ sent: 0, failed: 1 });
    expect(sent).toEqual(["a@example.test"]);
    const [b] = await db.select().from(outbox).where(eq(outbox.to, "b@example.test"));
    expect(b.attempts).toBe(2);
    expect(b.lastError).toMatch(/unavailable/);
    for (let i = 0; i < MAX_ATTEMPTS; i++) await deliverOutbox(db, flaky);
    const [b2] = await db.select().from(outbox).where(eq(outbox.to, "b@example.test"));
    expect(b2.attempts).toBe(MAX_ATTEMPTS);
  });

  it("does nothing without an email provider", async () => {
    expect(await deliverOutbox(db, null)).toEqual({ sent: 0, failed: 0 });
  });
});

describe("production settings", () => {
  const good = {
    NODE_ENV: "production",
    DATABASE_URL: "postgres://x",
    DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString("base64"),
    APP_URL: "https://app.example.test",
    CRON_SECRET: "s".repeat(40),
    SMTP_URL: "smtps://u:p@smtp.example.test:465",
  };
  const stub = (env: Record<string, string>) => Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));

  it("accepts a complete configuration", () => {
    stub(good);
    expect(() => checkProductionConfig()).not.toThrow();
  });

  it("refuses to start without secrets, with a short key, or without https", () => {
    stub({ ...good, CRON_SECRET: "" });
    expect(() => checkProductionConfig()).toThrow(/CRON_SECRET/);
    stub({ ...good, DATA_ENCRYPTION_KEY: Buffer.alloc(16).toString("base64") });
    expect(() => checkProductionConfig()).toThrow(/32 bytes/);
    stub({ ...good, APP_URL: "http://app.example.test" });
    expect(() => checkProductionConfig()).toThrow(/https/);
  });
});

describe("provisioning a customer", () => {
  it("creates the organization, homes and an owner invitation that works", async () => {
    const { provisionOrganization } = await import("@/server/provision");
    const { describeToken } = await import("@/server/auth");
    const r = await provisionOrganization(
      db,
      { orgName: "Lakeside Homes", homes: [{ name: "North House", timeZone: "America/Chicago", beds: 6 }, { name: "South House", timeZone: "America/Chicago" }], owner: { name: "Sam Rivera", email: "Sam@Lakeside.test" } },
      "https://app.example.test",
    );
    const token = r.inviteLink.split("/invite/")[1];
    expect(await describeToken(db, token, ["invite"])).toMatchObject({ name: "Sam Rivera", email: "sam@lakeside.test" });
    const [mail] = await db.select().from(outbox).where(eq(outbox.to, "sam@lakeside.test"));
    expect(mail.body).toContain(r.inviteLink);
    await expect(provisionOrganization(db, { orgName: "Again", homes: [{ name: "X House", timeZone: "America/Chicago" }], owner: { name: "Sam Rivera", email: "sam@lakeside.test" } }, "https://app.example.test")).rejects.toThrow(/already exists/);
    await expect(provisionOrganization(db, { orgName: "Bad", homes: [{ name: "Y House", timeZone: "Mars/Olympus" }], owner: { name: "Pat Lee", email: "pat@x.test" } }, "https://app.example.test")).rejects.toThrow();
  });
});
