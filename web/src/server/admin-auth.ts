import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { adminAudit, adminSessions, platformAdmins, type PlatformAdmin } from "@/db/schema";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { BREACHED, checkPasswordPolicy, hashPassword, isBreached, verifyPassword } from "@/lib/password";
import { checkTotp, newTotpSecret, totpUri } from "@/lib/totp";

/**
 * Sign-in for the admin site (admin.carehouseone.com). Separate from the app's users: a platform
 * admin belongs to no organization, and every sign-in needs the password and an authenticator code.
 */
export const ADMIN_IDLE_MINUTES = 30;
export const ADMIN_MAX_HOURS = 12;
const PENDING_MINUTES = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
export const ADMIN_SETUP_DAYS = 2;
const GENERIC_FAIL = "That email and password don't match.";

const minutes = (n: number) => new Date(Date.now() + n * 60_000);

/** Records something done on the admin site. */
export async function adminLog(
  db: DB,
  e: { adminId: string | null; orgId?: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(adminAudit).values({ adminId: e.adminId, orgId: e.orgId ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null, details: e.details ?? {} });
}

/**
 * Creates an admin (or gives an existing one a fresh setup link, for a forgotten password or a lost
 * phone: the authenticator is reset too). Returns the single-use setup token.
 */
export async function createAdmin(db: DB, email: string, name: string): Promise<string> {
  const token = randomToken();
  const values = {
    name: name.trim(),
    passwordHash: null,
    mfaSecretEnc: encrypt(newTotpSecret()),
    setupTokenHash: sha256(token),
    setupExpiresAt: new Date(Date.now() + ADMIN_SETUP_DAYS * 86_400_000),
    failedLogins: 0,
    lockedUntil: null,
    disabledAt: null,
  };
  const clean = email.trim().toLowerCase();
  const [existing] = await db.select().from(platformAdmins).where(eq(platformAdmins.email, clean));
  const [admin] = existing
    ? await db.update(platformAdmins).set(values).where(eq(platformAdmins.id, existing.id)).returning()
    : await db.insert(platformAdmins).values({ email: clean, ...values }).returning();
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(and(eq(adminSessions.adminId, admin.id), isNull(adminSessions.revokedAt)));
  await adminLog(db, { adminId: null, action: existing ? "admin_reset" : "admin_created", entity: "platform_admin", entityId: admin.id, details: { email: clean } });
  return token;
}

async function bySetupToken(db: DB, token: string): Promise<PlatformAdmin | null> {
  const [a] = await db
    .select()
    .from(platformAdmins)
    .where(and(eq(platformAdmins.setupTokenHash, sha256(token)), gt(platformAdmins.setupExpiresAt, new Date()), isNull(platformAdmins.disabledAt)));
  return a ?? null;
}

/** For the setup page: who it's for, and the authenticator secret to scan. */
export async function describeAdminSetup(db: DB, token: string): Promise<{ email: string; name: string; secret: string; uri: string } | null> {
  const a = await bySetupToken(db, token);
  if (!a) return null;
  const secret = decrypt(a.mfaSecretEnc);
  return { email: a.email, name: a.name, secret, uri: totpUri(secret, `${a.email} (admin)`) };
}

/** Sets the password once the authenticator shows the right code. The link then stops working. */
export async function completeAdminSetup(db: DB, token: string, password: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const a = await bySetupToken(db, token);
  if (!a) return { ok: false, error: "This setup link has expired or was already used." };
  const policy = checkPasswordPolicy(password, a.email);
  if (policy) return { ok: false, error: policy };
  if (await isBreached(password)) return { ok: false, error: BREACHED };
  if (!(await checkTotp(decrypt(a.mfaSecretEnc), code))) return { ok: false, error: "That code isn't right. Check the time on your phone and enter the newest code." };
  await db.update(platformAdmins).set({ passwordHash: await hashPassword(password), setupTokenHash: null, setupExpiresAt: null }).where(eq(platformAdmins.id, a.id));
  await adminLog(db, { adminId: a.id, action: "admin_setup_completed", entity: "platform_admin", entityId: a.id });
  return { ok: true };
}

let decoyHash: Promise<string> | null = null;

async function recordFailure(db: DB, a: PlatformAdmin, reason: string): Promise<string> {
  const failed = a.failedLogins + 1;
  const lock = failed >= MAX_FAILED;
  await db.update(platformAdmins).set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? minutes(LOCK_MINUTES) : a.lockedUntil }).where(eq(platformAdmins.id, a.id));
  await adminLog(db, { adminId: a.id, action: lock ? "admin_locked" : "admin_sign_in_failed", entity: "platform_admin", entityId: a.id, details: { reason } });
  return lock ? `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` : reason === "password" ? GENERIC_FAIL : "That code isn't right. Try again.";
}

/** Step 1: email and password. Returns a pending session that still needs the code. */
export async function adminSignIn(db: DB, email: string, password: string, userAgent?: string): Promise<{ ok: true; token: string; expiresAt: Date } | { ok: false; error: string }> {
  const [a] = await db.select().from(platformAdmins).where(sql`lower(${platformAdmins.email}) = ${email.trim().toLowerCase()}`);
  if (!a || !a.passwordHash || a.disabledAt) {
    decoyHash ??= hashPassword(randomToken());
    await verifyPassword(await decoyHash, password);
    return { ok: false, error: GENERIC_FAIL };
  }
  if (a.lockedUntil && a.lockedUntil > new Date()) return { ok: false, error: "Too many attempts. Try again later." };
  if (!(await verifyPassword(a.passwordHash, password))) return { ok: false, error: await recordFailure(db, a, "password") };
  const token = randomToken();
  const expiresAt = minutes(PENDING_MINUTES);
  await db.insert(adminSessions).values({ adminId: a.id, tokenHash: sha256(token), mfaPassed: false, expiresAt, userAgent: userAgent?.slice(0, 300) });
  return { ok: true, token, expiresAt };
}

/** Step 2: the authenticator code. */
export async function adminVerify(db: DB, token: string, code: string): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: string; restart?: boolean }> {
  const [row] = await db
    .select({ s: adminSessions, a: platformAdmins })
    .from(adminSessions)
    .innerJoin(platformAdmins, eq(platformAdmins.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, sha256(token)), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date()), eq(adminSessions.mfaPassed, false)));
  if (!row || row.a.disabledAt) return { ok: false, error: "Your sign-in timed out. Start again.", restart: true };
  if (!(await checkTotp(decrypt(row.a.mfaSecretEnc), code))) {
    const msg = await recordFailure(db, row.a, "code");
    const locked = msg.startsWith("Too many");
    if (locked) await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, row.s.id));
    return { ok: false, error: msg, restart: locked };
  }
  const expiresAt = new Date(Date.now() + ADMIN_MAX_HOURS * 3_600_000);
  await db.update(adminSessions).set({ mfaPassed: true, expiresAt, lastSeenAt: new Date() }).where(eq(adminSessions.id, row.s.id));
  await db.update(platformAdmins).set({ failedLogins: 0, lastSignInAt: new Date() }).where(eq(platformAdmins.id, row.a.id));
  await adminLog(db, { adminId: row.a.id, action: "admin_sign_in", entity: "platform_admin", entityId: row.a.id });
  return { ok: true, expiresAt };
}

export interface AdminUser {
  id: string;
  email: string;
  name: string;
}

/** The signed-in admin for a full session, enforcing the idle timeout. */
export async function getAdmin(db: DB, token: string): Promise<AdminUser | null> {
  const [row] = await db
    .select({ s: adminSessions, a: platformAdmins })
    .from(adminSessions)
    .innerJoin(platformAdmins, eq(platformAdmins.id, adminSessions.adminId))
    .where(and(eq(adminSessions.tokenHash, sha256(token)), isNull(adminSessions.revokedAt), gt(adminSessions.expiresAt, new Date()), eq(adminSessions.mfaPassed, true)));
  if (!row || row.a.disabledAt) return null;
  const idle = Date.now() - row.s.lastSeenAt.getTime();
  if (idle > ADMIN_IDLE_MINUTES * 60_000) {
    await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, row.s.id));
    return null;
  }
  if (idle > 60_000) await db.update(adminSessions).set({ lastSeenAt: new Date() }).where(eq(adminSessions.id, row.s.id));
  return { id: row.a.id, email: row.a.email, name: row.a.name };
}

export async function adminSignOut(db: DB, token: string): Promise<void> {
  await db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.tokenHash, sha256(token)));
}
