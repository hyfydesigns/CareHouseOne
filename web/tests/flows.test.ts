import { eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { accountTokens, auditLog, outbox, sessions, users } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { currentTotp } from "@/lib/totp";
import {
  acceptInvite,
  beginEnrollment,
  confirmEnrollment,
  describeToken,
  getSessionUser,
  requestPasswordReset,
  resetPassword,
  signIn,
  verifyMfa,
} from "@/server/auth";
import { DEMO_PASSWORD, seedDemo, type Seeded } from "@/server/seed";
import { cancelInvite, deactivateStaff, inviteStaff, listStaff, reactivateStaff, resendInvite } from "@/server/staff";
import type { Actor } from "@/lib/permissions";

const APP = "http://localhost:3000";
let db: DB;
let s: Seeded;
let other: Seeded;

const actor = (u: { id: string }, role: Actor["role"], facilityIds: string[]): Actor => ({ id: u.id, role, facilityIds });
const lastLink = async (to: string) => {
  const rows = await db.select().from(outbox).where(eq(outbox.to, to));
  const body = rows[rows.length - 1]?.body ?? "";
  return body.match(/\/(?:invite|reset)\/([\w-]+)/)?.[1] ?? "";
};
async function fullSignIn(email: string, secret: string, password = DEMO_PASSWORD) {
  const r = await signIn(db, { email, password });
  if (!r.ok) throw new Error(r.error);
  const v = await verifyMfa(db, r.token, await currentTotp(secret));
  if (!v.ok) throw new Error(v.error);
  return r.token;
}

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
});

describe("sign-in", () => {
  it("requires password then two-step code before a session works", async () => {
    const r = await signIn(db, { email: s.users.manager.email, password: DEMO_PASSWORD });
    expect(r.ok && r.next).toBe("mfa");
    if (!r.ok) return;
    expect(await getSessionUser(db, r.token)).toBeNull();
    expect((await verifyMfa(db, r.token, "000000")).ok).toBe(false);
    const v = await verifyMfa(db, r.token, await currentTotp(s.users.manager.totpSecret));
    expect(v.ok).toBe(true);
    const me = await getSessionUser(db, r.token);
    expect(me?.name).toBe("Daniel Ruiz");
    expect(me?.facilityIds).toEqual([s.facilities.cedarRidge]);
  });

  it("gives the same message for an unknown email and a wrong password", async () => {
    const a = await signIn(db, { email: "nobody@example.test", password: "whatever-password" });
    const b = await signIn(db, { email: s.users.nurse.email, password: "wrong-password-123" });
    expect(!a.ok && !b.ok && a.error === b.error).toBe(true);
  });

  it("locks the account after 5 wrong passwords", async () => {
    const email = s.users.nurse.email;
    await db.update(users).set({ failedLogins: 0 }).where(eq(users.id, s.users.nurse.id));
    let last = "";
    for (let i = 0; i < 4; i++) {
      const r = await signIn(db, { email, password: `wrong-password-${i}x` });
      if (!r.ok) last = r.error;
    }
    const r5 = await signIn(db, { email, password: "wrong-password-5x" });
    expect(!r5.ok && r5.error).toMatch(/Too many attempts/);
    const ok = await signIn(db, { email, password: DEMO_PASSWORD });
    expect(!ok.ok && ok.error).toMatch(/Too many attempts/);
    expect(last).toMatch(/don't match/);
    await db.update(users).set({ lockedUntil: null }).where(eq(users.id, s.users.nurse.id));
  });

  it("ends a session after the idle timeout", async () => {
    const token = await fullSignIn(s.users.owner.email, s.users.owner.totpSecret);
    await db.update(sessions).set({ lastSeenAt: new Date(Date.now() - 60 * 60_000) }).where(eq(sessions.userId, s.users.owner.id));
    expect(await getSessionUser(db, token)).toBeNull();
  });
});

describe("password reset", () => {
  it("resets with a single-use link and signs out other sessions", async () => {
    const before = await fullSignIn(s.users.caregiver.email, s.users.caregiver.totpSecret);
    await requestPasswordReset(db, s.users.caregiver.email, APP);
    const link = await lastLink(s.users.caregiver.email);
    expect(link).not.toBe("");
    expect((await resetPassword(db, link, "password1234")).ok).toBe(false);
    expect((await resetPassword(db, link, "a brand new phrase 2026")).ok).toBe(true);
    expect((await resetPassword(db, link, "another new phrase 2026")).ok).toBe(false);
    expect(await getSessionUser(db, before)).toBeNull();
    const again = await signIn(db, { email: s.users.caregiver.email, password: "a brand new phrase 2026" });
    expect(again.ok).toBe(true);
  });

  it("doesn't reveal unknown emails", async () => {
    const n = (await db.select().from(outbox)).length;
    await requestPasswordReset(db, "nobody@example.test", APP);
    expect((await db.select().from(outbox)).length).toBe(n);
  });
});

describe("asking for a new link", () => {
  it("sends a lapsed invitee a fresh invitation from 'Forgot password', and kills the old link", async () => {
    const own = actor(s.users.owner, "owner", [s.facilities.cedarRidge, s.facilities.mapleHouse]);
    await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, own, s.orgId, { name: "Lapsed Admin", email: "lapsed@harborviewliving.test", role: "admin", facilityIds: [s.facilities.cedarRidge] }, APP),
    );
    const first = await lastLink("lapsed@harborviewliving.test");
    await db.update(accountTokens).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(accountTokens.tokenHash, sha256(first)));
    expect(await describeToken(db, first, ["invite"])).toBeNull();

    await requestPasswordReset(db, "Lapsed@HarborviewLiving.test", APP);
    const fresh = await lastLink("lapsed@harborviewliving.test");
    expect(fresh).not.toBe(first);
    expect(await describeToken(db, fresh, ["invite"])).toMatchObject({ email: "lapsed@harborviewliving.test", purpose: "invite" });
    const [mail] = (await db.select().from(outbox).where(eq(outbox.to, "lapsed@harborviewliving.test"))).slice(-1);
    expect(mail.subject).toBe("Your new CareHouse One sign-in link");
    expect((await acceptInvite(db, fresh, "harbor sunrise walk 2026")).ok).toBe(true);
  });

  it("still sends active people a reset link, and unknown emails nothing", async () => {
    const before = (await db.select().from(outbox)).length;
    await requestPasswordReset(db, "nobody-here@harborviewliving.test", APP);
    expect((await db.select().from(outbox)).length).toBe(before);
    await requestPasswordReset(db, s.users.manager.email, APP);
    const [mail] = (await db.select().from(outbox).where(eq(outbox.to, s.users.manager.email))).slice(-1);
    expect(mail.subject).toBe("Reset your CareHouse One password");
  });
});

describe("staff lifecycle", () => {
  it("lets a manager invite a caregiver, who sets a password and is sent to the home's tablet", async () => {
    const mgr = actor(s.users.manager, "manager", [s.facilities.cedarRidge]);
    const res = await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, mgr, s.orgId, { name: "Marisol Vega", email: "marisol.vega@harborviewliving.test", role: "caregiver", facilityIds: [s.facilities.cedarRidge] }, APP),
    );
    expect(res.ok).toBe(true);
    const link = await lastLink("marisol.vega@harborviewliving.test");
    // Away from a registered tablet: password saved, no session, no authenticator setup.
    const acc = await acceptInvite(db, link, "harbor sunrise walk 2026");
    expect(acc.ok && acc.next).toBe("tablet-only");
    const away = await signIn(db, { email: "marisol.vega@harborviewliving.test", password: "harbor sunrise walk 2026" });
    expect(!away.ok && away.error).toMatch(/home's tablet/);
    expect((await acceptInvite(db, link, "harbor sunrise walk 2026")).ok).toBe(false);
  });

  it("has admins set a password and two-step verification", async () => {
    const owner = actor(s.users.owner, "owner", [s.facilities.cedarRidge, s.facilities.mapleHouse]);
    await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, owner, s.orgId, { name: "Ruth Adeyemi", email: "ruth.adeyemi@harborviewliving.test", role: "admin", facilityIds: [s.facilities.cedarRidge] }, APP),
    );
    const link = await lastLink("ruth.adeyemi@harborviewliving.test");
    const acc = await acceptInvite(db, link, "harbor sunrise walk 2026");
    expect(acc.ok && acc.next).toBe("enroll");
    if (!acc.ok || acc.next === "tablet-only") return;
    const enr = await beginEnrollment(db, acc.token);
    expect(enr?.uri).toMatch(/^otpauth:\/\/totp\//);
    const done = await confirmEnrollment(db, acc.token, await currentTotp(enr!.secret));
    expect(done.ok).toBe(true);
    expect((await getSessionUser(db, acc.token))?.role).toBe("admin");
  });

  it("stops managers adding other roles, other homes, or duplicate emails", async () => {
    const mgr = actor(s.users.manager, "manager", [s.facilities.cedarRidge]);
    const nurse = await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, mgr, s.orgId, { name: "Nia Okoro", email: "nia@harborviewliving.test", role: "nurse", facilityIds: [s.facilities.cedarRidge] }, APP),
    );
    const otherHome = await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, mgr, s.orgId, { name: "Nia Okoro", email: "nia@harborviewliving.test", role: "caregiver", facilityIds: [s.facilities.mapleHouse] }, APP),
    );
    const dup = await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, mgr, s.orgId, { name: "Andre Again", email: "ANDRE.THOMAS@harborviewliving.test", role: "caregiver", facilityIds: [s.facilities.cedarRidge] }, APP),
    );
    expect([nurse.ok, otherHome.ok, dup.ok]).toEqual([false, false, false]);
  });

  it("resends (old link dies) and cancels invitations", async () => {
    const own = actor(s.users.owner, "owner", [s.facilities.cedarRidge, s.facilities.mapleHouse]);
    await withTenant(db, s.orgId, (tx) =>
      inviteStaff(tx, own, s.orgId, { name: "Owen Clarke", email: "owen@harborviewliving.test", role: "admin", facilityIds: [s.facilities.mapleHouse] }, APP),
    );
    const first = await lastLink("owen@harborviewliving.test");
    const [owen] = await db.select().from(users).where(eq(users.email, "owen@harborviewliving.test"));
    expect((await withTenant(db, s.orgId, (tx) => resendInvite(tx, own, owen.id, APP))).ok).toBe(true);
    expect((await acceptInvite(db, first, "harbor sunrise walk 2026")).ok).toBe(false);
    expect((await withTenant(db, s.orgId, (tx) => cancelInvite(tx, own, owen.id))).ok).toBe(true);
    expect(await db.select().from(users).where(eq(users.id, owen.id))).toHaveLength(0);
  });

  it("deactivates (signs out everywhere) and reactivates with a fresh password", async () => {
    const token = await fullSignIn(s.users.caregiver.email, s.users.caregiver.totpSecret, "a brand new phrase 2026");
    const mgr = actor(s.users.manager, "manager", [s.facilities.cedarRidge]);
    const d = await withTenant(db, s.orgId, (tx) => deactivateStaff(tx, mgr, s.users.caregiver.id, { reason: "Resigned" }));
    expect(d.ok).toBe(true);
    expect(await getSessionUser(db, token)).toBeNull();
    expect((await signIn(db, { email: s.users.caregiver.email, password: "a brand new phrase 2026" })).ok).toBe(false);
    const r = await withTenant(db, s.orgId, (tx) => reactivateStaff(tx, mgr, s.users.caregiver.id, APP));
    expect(r.ok).toBe(true);
    const link = await lastLink(s.users.caregiver.email);
    // A returning caregiver sets a new password, then signs in on the home's tablet (reactivation clears two-step).
    const acc = await acceptInvite(db, link, "returning to harbor 2026");
    expect(acc.ok && acc.next).toBe("tablet-only");
  });

  it("sends people gone over 12 months to rehire instead of reactivation", async () => {
    const own = actor(s.users.owner, "owner", [s.facilities.cedarRidge, s.facilities.mapleHouse]);
    await db.update(users).set({ status: "deactivated", deactivatedAt: new Date(Date.now() - 400 * 86_400_000) }).where(eq(users.id, s.users.nurse.id));
    const r = await withTenant(db, s.orgId, (tx) => reactivateStaff(tx, own, s.users.nurse.id, APP));
    expect(!r.ok && r.error).toMatch(/new hire/);
    const list = await withTenant(db, s.orgId, (tx) => listStaff(tx, own));
    expect(list.find((x) => x.id === s.users.nurse.id)?.rehireOnly).toBe(true);
  });

  it("won't deactivate the last owner, and owners can't deactivate themselves", async () => {
    const own = actor(s.users.owner, "owner", [s.facilities.cedarRidge]);
    const r = await withTenant(db, s.orgId, (tx) => deactivateStaff(tx, own, s.users.owner.id, { reason: "Other" }));
    expect(r.ok).toBe(false);
  });
});

describe("tenant isolation and audit", () => {
  it("never shows one organization's rows to another", async () => {
    const seen = await withTenant(db, other.orgId, (tx) => tx.select().from(users));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((u) => u.orgId === other.orgId)).toBe(true);
    const leak = await withTenant(db, other.orgId, (tx) => tx.select().from(users).where(eq(users.id, s.users.owner.id)));
    expect(leak).toHaveLength(0);
  });

  it("blocks writing rows into another organization", async () => {
    await expect(
      withTenant(db, other.orgId, (tx) => tx.insert(accountTokens).values({ orgId: s.orgId, userId: s.users.owner.id, purpose: "reset", tokenHash: "x", expiresAt: new Date() })),
    ).rejects.toThrow();
  });

  it("records actions in an audit log that can't be changed or deleted", async () => {
    const rows = await db.select().from(auditLog).where(eq(auditLog.orgId, s.orgId));
    const actions = new Set(rows.map((r) => r.action));
    for (const a of ["sign_in", "sign_in_failed", "account_locked", "invitation_sent", "invitation_accepted", "mfa_enrolled", "user_deactivated", "user_reactivated", "password_reset"]) {
      expect(actions.has(a)).toBe(true);
    }
    const why = async (q: Promise<unknown>) => q.then(() => "no error", (e: { cause?: { message?: string }; message: string }) => e.cause?.message ?? e.message);
    expect(await why(db.execute(sql`update audit_log set action = 'edited'`))).toMatch(/append-only/);
    expect(await why(db.execute(sql`delete from audit_log`))).toMatch(/append-only/);
  });
});
