import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { devicePins, devices, facilities, sessions, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { hashPassword, verifyPassword } from "@/lib/password";
import { canSeeFacility, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import type { SessionUser } from "./auth";
import type { Result } from "./residents";

/** Owners and admins register and remove the home tablets (from Settings). */
export function canManageDevices(actor: Pick<Actor, "role">): boolean {
  return actor.role === "owner" || actor.role === "admin";
}

const registerSchema = z.object({
  facilityId: z.string().uuid("Choose a home."),
  name: z.string().trim().min(2, "Name the tablet, for example Cedar Ridge med room.").max(60),
});

/** Registers the browser it's called from. The caller stores the returned token in a long-lived cookie. */
export async function registerDevice(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result<{ token: string }>> {
  const p = registerSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!canManageDevices(actor)) return { ok: false, error: "You can't register tablets for that home." };
  const token = randomToken();
  const [d] = await tx.insert(devices).values({ orgId, facilityId: p.data.facilityId, name: p.data.name, tokenHash: sha256(token), registeredBy: actor.id }).returning();
  await audit(tx, { orgId, actorId: actor.id, action: "device_registered", entity: "device", entityId: d.id, details: { facilityId: d.facilityId, name: d.name } });
  return { ok: true, message: `This tablet is now registered to the home as "${d.name}".`, data: { token } };
}

/** Revoking ends every session opened on the tablet and clears its PINs: a remote lock-out. */
export async function revokeDevice(tx: Tx, actor: Actor, deviceId: string): Promise<Result> {
  const [d] = await tx.select().from(devices).where(eq(devices.id, deviceId));
  if (!d || d.revokedAt) return { ok: false, error: "That tablet is already removed." };
  if (!canManageDevices(actor)) return { ok: false, error: "You can't manage that tablet." };
  await tx.update(devices).set({ revokedAt: new Date(), revokedBy: actor.id }).where(eq(devices.id, d.id));
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.deviceId, d.id), isNull(sessions.revokedAt)));
  await tx.delete(devicePins).where(eq(devicePins.deviceId, d.id));
  await audit(tx, { orgId: d.orgId, actorId: actor.id, action: "device_revoked", entity: "device", entityId: d.id });
  return { ok: true, message: `"${d.name}" is removed and signed out.` };
}

export async function listDevices(tx: Tx, actor: Actor) {
  const rows = await tx
    .select({ d: devices, home: facilities.name, by: users.name })
    .from(devices)
    .innerJoin(facilities, eq(facilities.id, devices.facilityId))
    .leftJoin(users, eq(users.id, devices.registeredBy))
    .orderBy(asc(facilities.name), asc(devices.name));
  return rows.filter((r) => canSeeFacility(actor, r.d.facilityId));
}

/** Looks up an active device from its cookie (runs before the organization is known). */
export async function resolveDevice(db: DB, token: string | undefined) {
  if (!token) return null;
  const [d] = await db.select().from(devices).where(and(eq(devices.tokenHash, sha256(token)), isNull(devices.revokedAt)));
  return d ?? null;
}

export const MAX_PIN_ATTEMPTS = 5;

/** 4 to 8 digits, and not something anyone would guess first. */
export function checkPin(pin: string): string | null {
  if (!/^\d{4,8}$/.test(pin)) return "Use 4 to 8 digits.";
  if (/^(\d)\1+$/.test(pin)) return "Don't use the same digit over and over.";
  const asc = "0123456789012", desc = "9876543210987";
  if (asc.includes(pin) || desc.includes(pin)) return "Don't use digits in a row, like 1234.";
  return null;
}

/** After a full sign-in on a shared tablet, the person picks a PIN that lasts until the session ends. */
export async function setPin(db: DB, user: SessionUser, pin: string, confirm: string): Promise<Result> {
  if (!user.device) return { ok: false, error: "PINs are only for registered tablets." };
  const problem = checkPin(pin);
  if (problem) return { ok: false, error: problem };
  if (pin !== confirm) return { ok: false, error: "The two PINs don't match." };
  const [s] = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.id, user.sessionId));
  const values = { orgId: user.orgId, deviceId: user.device.id, userId: user.id, pinHash: await hashPassword(pin), failed: 0, expiresAt: s.expiresAt };
  await db.insert(devicePins).values(values).onConflictDoUpdate({ target: [devicePins.deviceId, devicePins.userId], set: { pinHash: values.pinHash, failed: 0, expiresAt: values.expiresAt } });
  await audit(db, { orgId: user.orgId, actorId: user.id, action: "device_pin_set", entity: "device", entityId: user.device.id });
  return { ok: true, message: "PIN saved." };
}

export async function lockSession(db: DB, user: SessionUser): Promise<void> {
  if (!user.device || user.locked) return;
  await db.update(sessions).set({ lockedAt: new Date() }).where(eq(sessions.id, user.sessionId));
}

/** Too many wrong PINs end the session, so the next try needs the password and two-step code. */
export async function unlockWithPin(db: DB, user: SessionUser, pin: string): Promise<{ ok: true } | { ok: false; error: string; signedOut?: boolean }> {
  if (!user.device) return { ok: false, error: "This isn't a registered tablet.", signedOut: true };
  const [row] = await db
    .select()
    .from(devicePins)
    .where(and(eq(devicePins.deviceId, user.device.id), eq(devicePins.userId, user.id), gt(devicePins.expiresAt, new Date())));
  if (!row) return { ok: false, error: "Sign in again to continue.", signedOut: true };
  if (await verifyPassword(row.pinHash, pin)) {
    await db.update(devicePins).set({ failed: 0 }).where(and(eq(devicePins.deviceId, row.deviceId), eq(devicePins.userId, row.userId)));
    await db.update(sessions).set({ lockedAt: null, lastSeenAt: new Date() }).where(eq(sessions.id, user.sessionId));
    return { ok: true };
  }
  const failed = row.failed + 1;
  if (failed >= MAX_PIN_ATTEMPTS) {
    await db.delete(devicePins).where(and(eq(devicePins.deviceId, row.deviceId), eq(devicePins.userId, row.userId)));
    await db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, user.sessionId));
    await audit(db, { orgId: user.orgId, actorId: user.id, action: "device_pin_locked_out", entity: "device", entityId: row.deviceId });
    return { ok: false, error: "Too many wrong PINs. Sign in with your password.", signedOut: true };
  }
  await db.update(devicePins).set({ failed }).where(and(eq(devicePins.deviceId, row.deviceId), eq(devicePins.userId, row.userId)));
  const left = MAX_PIN_ATTEMPTS - failed;
  return { ok: false, error: `That PIN isn't right. ${left} ${left === 1 ? "try" : "tries"} left.` };
}
