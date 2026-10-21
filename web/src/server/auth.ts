import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { accountTokens, devicePins, devices, sessions, userFacilities, users, type User } from "@/db/schema";
import { decrypt, encrypt, randomToken, sha256 } from "@/lib/crypto";
import { BREACHED, checkPasswordPolicy, hashPassword, isBreached, verifyPassword } from "@/lib/password";
import { checkTotp, newTotpSecret, totpUri } from "@/lib/totp";
import { audit, sendMail } from "./audit";

export const SESSION_IDLE_MINUTES = Number(process.env.SESSION_IDLE_MINUTES || 15);
export const SESSION_MAX_HOURS = 12;
/** Server-side backstop; the tablet itself locks after 2 minutes without a touch. */
export const DEVICE_LOCK_MINUTES = 5;
const PENDING_MINUTES = 10;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 30;
export const INVITE_DAYS = 7;

const minutes = (n: number) => new Date(Date.now() + n * 60_000);
const GENERIC_FAIL = "That email and password don't match.";

/**
 * Two-step verification is optional: anyone can turn it on under Account, and then every sign-in
 * asks for the code.
 * "done": signed in.
 * "mfa": a pending session that still needs the two-step code.
 * "tablet-only": invitation accepted by a caregiver away from the tablet; no session.
 */
export type SignInResult = { ok: true; token: string; next: "mfa" | "done"; expiresAt: Date } | { ok: false; error: string };
export type InviteResult = SignInResult | { ok: true; next: "tablet-only" };

const CAREGIVER_ROLES: ReadonlyArray<User["role"]> = ["caregiver", "med_caregiver"];
const TABLET_ONLY = "Caregivers sign in on their home's tablet. Ask your manager if you need to sign in somewhere else.";

// A real hash to compare against when the email is unknown, so timing doesn't reveal accounts.
let decoyHash: Promise<string> | null = null;

async function findActiveByEmail(db: DB, email: string): Promise<User | null> {
  const rows = await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`);
  const active = rows.filter((u) => u.status === "active");
  return active.length === 1 ? active[0] : null;
}

async function recordFailure(db: DB, user: User, reason: string): Promise<string> {
  const failed = user.failedLogins + 1;
  const lock = failed >= MAX_FAILED;
  await db
    .update(users)
    .set({ failedLogins: lock ? 0 : failed, lockedUntil: lock ? minutes(LOCK_MINUTES) : user.lockedUntil })
    .where(eq(users.id, user.id));
  await audit(db, { orgId: user.orgId, actorId: user.id, action: lock ? "account_locked" : "sign_in_failed", entity: "user", entityId: user.id, details: { reason } });
  return lock ? `Too many attempts. Try again in ${LOCK_MINUTES} minutes.` : reason === "password" ? GENERIC_FAIL : "That code isn't right. Try again.";
}

/**
 * Caregivers sign in on a registered tablet belonging to one of their homes: only an owner can
 * register one, it can be removed remotely, and the person then sets a PIN that locks it. A
 * caregiver who has turned on two-step verification can also sign in elsewhere with the code.
 */
async function tabletSignIn(db: DB, user: User, deviceId: string | null): Promise<boolean> {
  if (!deviceId || !CAREGIVER_ROLES.includes(user.role)) return false;
  const [d] = await db.select({ facilityId: devices.facilityId }).from(devices).where(eq(devices.id, deviceId));
  if (!d) return false;
  const [link] = await db.select().from(userFacilities).where(and(eq(userFacilities.userId, user.id), eq(userFacilities.facilityId, d.facilityId)));
  return !!link;
}

/** Email and password; then the two-step code only for people who turned it on. */
export async function signIn(db: DB, input: { email: string; password: string; userAgent?: string; deviceId?: string | null }): Promise<SignInResult> {
  const user = await findActiveByEmail(db, input.email);
  if (!user || !user.passwordHash) {
    decoyHash ??= hashPassword(randomToken());
    await verifyPassword(await decoyHash, input.password);
    return { ok: false, error: GENERIC_FAIL };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const mins = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000);
    return { ok: false, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? "" : "s"}.` };
  }
  if (!(await verifyPassword(user.passwordHash, input.password))) {
    return { ok: false, error: await recordFailure(db, user, "password") };
  }
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, user.id));
  const token = randomToken();
  const expiresAt = minutes(PENDING_MINUTES);
  const deviceId = input.deviceId ? await deviceForOrg(db, input.deviceId, user.orgId) : null;
  const tablet = await tabletSignIn(db, user, deviceId);
  if (!tablet && CAREGIVER_ROLES.includes(user.role) && !user.mfaEnabled) return { ok: false, error: TABLET_ONLY };
  const [session] = await db
    .insert(sessions)
    .values({ orgId: user.orgId, userId: user.id, tokenHash: sha256(token), mfaPassed: false, expiresAt, userAgent: input.userAgent?.slice(0, 300), deviceId })
    .returning();
  if (tablet) return { ok: true, token, next: "done", expiresAt: await completeSession(db, session.id, user, "sign_in_tablet") };
  if (!user.mfaEnabled) return { ok: true, token, next: "done", expiresAt: await completeSession(db, session.id, user, "sign_in") };
  return { ok: true, token, next: "mfa", expiresAt };
}

/** A tablet registered to another organization is treated as an ordinary browser. */
async function deviceForOrg(db: DB, deviceId: string, orgId: string): Promise<string | null> {
  const [d] = await db.select({ id: devices.id }).from(devices).where(and(eq(devices.id, deviceId), eq(devices.orgId, orgId), isNull(devices.revokedAt)));
  return d?.id ?? null;
}

async function pendingSession(db: DB, token: string) {
  const [row] = await db
    .select({ session: sessions, user: users })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));
  if (!row || row.session.mfaPassed || row.user.status !== "active") return null;
  return row;
}

async function completeSession(db: DB, sessionId: string, user: User, action: string) {
  const expiresAt = new Date(Date.now() + SESSION_MAX_HOURS * 3_600_000);
  await db.update(sessions).set({ mfaPassed: true, expiresAt, lastSeenAt: new Date() }).where(eq(sessions.id, sessionId));
  await db.update(users).set({ lastSignInAt: new Date(), failedLogins: 0 }).where(eq(users.id, user.id));
  await audit(db, { orgId: user.orgId, actorId: user.id, action, entity: "user", entityId: user.id });
  return expiresAt;
}

/** Step 2 for enrolled users: the 6-digit code from their authenticator app. */
export async function verifyMfa(db: DB, token: string, code: string): Promise<{ ok: true; expiresAt: Date } | { ok: false; error: string; restart?: boolean }> {
  const row = await pendingSession(db, token);
  if (!row || !row.user.mfaEnabled || !row.user.mfaSecretEnc) return { ok: false, error: "Your sign-in timed out. Start again.", restart: true };
  if (!(await checkTotp(decrypt(row.user.mfaSecretEnc), code))) {
    const msg = await recordFailure(db, row.user, "mfa");
    const locked = msg.startsWith("Too many");
    if (locked) await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return { ok: false, error: msg, restart: locked };
  }
  return { ok: true, expiresAt: await completeSession(db, row.session.id, row.user, "sign_in") };
}

/** Account page, signed in: create (or reuse) an authenticator secret that isn't switched on yet. */
export async function beginEnrollment(db: DB, userId: string): Promise<{ secret: string; uri: string } | null> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.mfaEnabled) return null;
  let secret = user.mfaSecretEnc ? decrypt(user.mfaSecretEnc) : null;
  if (!secret) {
    secret = newTotpSecret();
    await db.update(users).set({ mfaSecretEnc: encrypt(secret) }).where(eq(users.id, user.id));
  }
  return { secret, uri: totpUri(secret, user.email) };
}

/** Turns two-step verification on once the person proves their app shows the right code. */
export async function confirmEnrollment(db: DB, userId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || user.mfaEnabled || !user.mfaSecretEnc) return { ok: false, error: "Start the setup again." };
  if (!(await checkTotp(decrypt(user.mfaSecretEnc), code))) return { ok: false, error: "That code isn't right. Check the time on your phone and try the newest code." };
  await db.update(users).set({ mfaEnabled: true }).where(eq(users.id, user.id));
  await audit(db, { orgId: user.orgId, actorId: user.id, action: "mfa_enrolled", entity: "user", entityId: user.id });
  return { ok: true };
}

/** Turning it off needs a current code, so someone who only has the password can't remove it. */
export async function disableMfa(db: DB, userId: string, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.mfaEnabled || !user.mfaSecretEnc) return { ok: false, error: "Two-step verification isn't on." };
  if (!(await checkTotp(decrypt(user.mfaSecretEnc), code))) return { ok: false, error: "That code isn't right. Enter the newest code from your authenticator app." };
  await db.update(users).set({ mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, user.id));
  await audit(db, { orgId: user.orgId, actorId: user.id, action: "mfa_disabled", entity: "user", entityId: user.id });
  await sendMail(db, {
    orgId: user.orgId,
    to: user.email,
    subject: "Two-step verification was turned off",
    body: "Two-step verification was just turned off for your CareHouse One account. If this wasn't you, change your password and contact your manager right away.",
  });
  return { ok: true };
}

export interface SessionUser {
  sessionId: string;
  id: string;
  orgId: string;
  name: string;
  email: string;
  role: User["role"];
  facilityIds: string[];
  /** The registered shared tablet this session runs on, if any. */
  device: { id: string; facilityId: string; name: string } | null;
  /** Shared tablet only: locked until the person's PIN is entered. */
  locked: boolean;
  /** Shared tablet only: the person hasn't set a PIN for this tablet yet. */
  needsPin: boolean;
}

/** Returns the signed-in user for a full session, enforcing the idle timeout. */
export async function getSessionUser(db: DB, token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ session: sessions, user: users, device: devices })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(devices, eq(devices.id, sessions.deviceId))
    .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date()), eq(sessions.mfaPassed, true)));
  if (!row || row.user.status !== "active") return null;
  const u = row.user;
  const idleMs = Date.now() - row.session.lastSeenAt.getTime();
  const facs = async () => (await db.select({ id: userFacilities.facilityId }).from(userFacilities).where(eq(userFacilities.userId, u.id))).map((f) => f.id);

  if (row.device) {
    // Shared tablet: idle locks instead of signing out; the PIN unlocks until the session ends.
    if (row.device.revokedAt) return null;
    let locked = row.session.lockedAt !== null;
    if (!locked && idleMs > DEVICE_LOCK_MINUTES * 60_000) {
      await db.update(sessions).set({ lockedAt: new Date() }).where(eq(sessions.id, row.session.id));
      locked = true;
    }
    if (!locked && idleMs > 15_000) {
      await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
      await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, row.device.id));
    }
    const [pin] = await db
      .select({ userId: devicePins.userId })
      .from(devicePins)
      .where(and(eq(devicePins.deviceId, row.device.id), eq(devicePins.userId, u.id), gt(devicePins.expiresAt, new Date())));
    const device = { id: row.device.id, facilityId: row.device.facilityId, name: row.device.name };
    return { sessionId: row.session.id, id: u.id, orgId: u.orgId, name: u.name, email: u.email, role: u.role, facilityIds: await facs(), device, locked, needsPin: !pin };
  }

  if (idleMs > SESSION_IDLE_MINUTES * 60_000) {
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, row.session.id));
    return null;
  }
  if (idleMs > 60_000) await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  return { sessionId: row.session.id, id: u.id, orgId: u.orgId, name: u.name, email: u.email, role: u.role, facilityIds: await facs(), device: null, locked: false, needsPin: false };
}

export async function signOut(db: DB, token: string): Promise<void> {
  const [s] = await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(token))).returning();
  // A PIN only lives as long as the sign-in it was set in.
  if (s?.deviceId) await db.delete(devicePins).where(and(eq(devicePins.deviceId, s.deviceId), eq(devicePins.userId, s.userId)));
}

export async function revokeAllSessions(db: DB, userId: string): Promise<void> {
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
}

/** Always reports success, so the form can't be used to discover which emails have accounts. */
export async function requestPasswordReset(db: DB, email: string, appUrl: string): Promise<void> {
  const user = await findActiveByEmail(db, email);
  if (!user) {
    // Someone whose invitation lapsed (often a new owner, with no one else to resend it): a fresh one.
    const invited = (await db.select().from(users).where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)).filter((u) => u.status === "invited");
    if (invited.length === 1) await reissueInvitation(db, invited[0], appUrl);
    return;
  }
  const token = randomToken();
  await db.insert(accountTokens).values({ orgId: user.orgId, userId: user.id, purpose: "reset", tokenHash: sha256(token), expiresAt: minutes(RESET_MINUTES) });
  await sendMail(db, {
    orgId: user.orgId,
    to: user.email,
    subject: "Reset your CareHouse One password",
    body: `Use this link to choose a new password. It works once and expires in ${RESET_MINUTES} minutes.\n\n${appUrl}/reset/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
  await audit(db, { orgId: user.orgId, actorId: user.id, action: "password_reset_requested", entity: "user", entityId: user.id });
}

/**
 * Sends a new invitation (or reactivation) link to an invited person's own address, cancelling any
 * earlier one. Used when they ask for a link themselves; only ever goes to the email on the account.
 */
async function reissueInvitation(db: DB, user: User, appUrl: string): Promise<void> {
  const [last] = await db
    .select({ purpose: accountTokens.purpose })
    .from(accountTokens)
    .where(and(eq(accountTokens.userId, user.id), inArray(accountTokens.purpose, ["invite", "reactivate"])))
    .orderBy(desc(accountTokens.createdAt))
    .limit(1);
  const purpose = last?.purpose === "reactivate" ? "reactivate" : "invite";
  await db.update(accountTokens).set({ cancelledAt: new Date() }).where(and(eq(accountTokens.userId, user.id), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)));
  const token = randomToken();
  await db.insert(accountTokens).values({ orgId: user.orgId, userId: user.id, purpose, tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
  await sendMail(db, {
    orgId: user.orgId,
    to: user.email,
    subject: "Your new CareHouse One sign-in link",
    body: `Hi ${user.name},\n\nHere's a new link to set your CareHouse One password. It works once and expires in ${INVITE_DAYS} days.\n\n${appUrl}/invite/${token}\n\nIf you didn't ask for this, you can ignore this email.`,
  });
  await audit(db, { orgId: user.orgId, actorId: user.id, action: "invitation_requested", entity: "user", entityId: user.id });
}

async function liveToken(db: DB, token: string, purposes: Array<"invite" | "reset" | "reactivate">) {
  const [row] = await db
    .select({ t: accountTokens, user: users })
    .from(accountTokens)
    .innerJoin(users, eq(users.id, accountTokens.userId))
    .where(and(eq(accountTokens.tokenHash, sha256(token)), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt), gt(accountTokens.expiresAt, new Date())));
  if (!row || !purposes.includes(row.t.purpose)) return null;
  return row;
}

/** For the reset and invitation pages: is this link still usable, and for whom? */
export async function describeToken(db: DB, token: string, purposes: Array<"invite" | "reset" | "reactivate">) {
  const row = await liveToken(db, token, purposes);
  return row ? { name: row.user.name, email: row.user.email, purpose: row.t.purpose, role: row.user.role } : null;
}

export async function resetPassword(db: DB, token: string, password: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = await liveToken(db, token, ["reset"]);
  if (!row || row.user.status !== "active") return { ok: false, error: "This link has expired or was already used. Ask for a new one." };
  const problem = checkPasswordPolicy(password, row.user.email);
  if (problem) return { ok: false, error: problem };
  if (await isBreached(password)) return { ok: false, error: BREACHED };
  await db.update(users).set({ passwordHash: await hashPassword(password), failedLogins: 0, lockedUntil: null }).where(eq(users.id, row.user.id));
  await db.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.id, row.t.id));
  await revokeAllSessions(db, row.user.id);
  await audit(db, { orgId: row.user.orgId, actorId: row.user.id, action: "password_reset", entity: "user", entityId: row.user.id });
  await sendMail(db, { orgId: row.user.orgId, to: row.user.email, subject: "Your CareHouse One password was changed", body: "Your password was just changed and you were signed out on all devices. If this wasn't you, contact your manager right away." });
  return { ok: true };
}

/** Accepting an invitation or reactivation: set a password and sign straight in (caregivers only on their tablet). */
export async function acceptInvite(db: DB, token: string, password: string, userAgent?: string, deviceId?: string | null): Promise<InviteResult> {
  const row = await liveToken(db, token, ["invite", "reactivate"]);
  if (!row || row.user.status !== "invited") return { ok: false, error: "This invitation has expired or was cancelled. Ask your manager to send a new one." };
  const problem = checkPasswordPolicy(password, row.user.email);
  if (problem) return { ok: false, error: problem };
  if (await isBreached(password)) return { ok: false, error: BREACHED };
  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), status: "active", mfaEnabled: false, mfaSecretEnc: null, failedLogins: 0, lockedUntil: null, deactivatedAt: null, deactivationReason: null })
    .where(eq(users.id, row.user.id));
  await db.update(accountTokens).set({ usedAt: new Date() }).where(eq(accountTokens.id, row.t.id));
  await audit(db, { orgId: row.user.orgId, actorId: row.user.id, action: row.t.purpose === "invite" ? "invitation_accepted" : "reactivation_accepted", entity: "user", entityId: row.user.id });
  if (CAREGIVER_ROLES.includes(row.user.role)) {
    // On the tablet caregivers are signed straight in; anywhere else they're told to use the tablet.
    const device = deviceId ? await deviceForOrg(db, deviceId, row.user.orgId) : null;
    if (!(await tabletSignIn(db, row.user, device))) return { ok: true, next: "tablet-only" };
    const session = randomToken();
    const [s] = await db
      .insert(sessions)
      .values({ orgId: row.user.orgId, userId: row.user.id, tokenHash: sha256(session), mfaPassed: false, expiresAt: minutes(PENDING_MINUTES), userAgent: userAgent?.slice(0, 300), deviceId: device })
      .returning();
    return { ok: true, token: session, next: "done", expiresAt: await completeSession(db, s.id, row.user, "sign_in_tablet") };
  }
  const session = randomToken();
  const [s] = await db
    .insert(sessions)
    .values({ orgId: row.user.orgId, userId: row.user.id, tokenHash: sha256(session), mfaPassed: false, expiresAt: minutes(PENDING_MINUTES), userAgent: userAgent?.slice(0, 300) })
    .returning();
  return { ok: true, token: session, next: "done", expiresAt: await completeSession(db, s.id, row.user, "sign_in") };
}
