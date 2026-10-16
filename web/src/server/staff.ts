import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { accountTokens, facilities, sessions, userFacilities, users, type Role } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { canInvite, canManage, type Actor, type StaffTarget } from "@/lib/permissions";
import { audit, sendMail } from "./audit";
import { INVITE_DAYS } from "./auth";

export type Result = { ok: true; message: string } | { ok: false; error: string };

const days = (n: number) => new Date(Date.now() + n * 86_400_000);
const REHIRE_AFTER_DAYS = 365;

export interface StaffRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "invited" | "active" | "deactivated";
  facilityIds: string[];
  facilityNames: string[];
  mfaEnabled: boolean;
  lastSignInAt: Date | null;
  deactivatedAt: Date | null;
  deactivationReason: string | null;
  invite: { purpose: string; sentAt: Date; expiresAt: Date; expired: boolean } | null;
  canManage: boolean;
  rehireOnly: boolean;
}

async function targetOf(tx: Tx, userId: string): Promise<(StaffTarget & { user: typeof users.$inferSelect }) | null> {
  const [u] = await tx.select().from(users).where(eq(users.id, userId));
  if (!u) return null;
  const facs = await tx.select({ id: userFacilities.facilityId }).from(userFacilities).where(eq(userFacilities.userId, u.id));
  return { id: u.id, role: u.role, facilityIds: facs.map((f) => f.id), user: u };
}

/** Staff visible to the actor: everyone for owners and admins, people in their own homes otherwise. */
export async function listStaff(tx: Tx, actor: Actor): Promise<StaffRow[]> {
  const all = await tx.select().from(users).orderBy(users.name);
  const links = await tx.select().from(userFacilities);
  const facs = await tx.select().from(facilities);
  const tokens = await tx
    .select()
    .from(accountTokens)
    .where(and(inArray(accountTokens.purpose, ["invite", "reactivate"]), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)))
    .orderBy(desc(accountTokens.createdAt));
  const nameOf = new Map(facs.map((f) => [f.id, f.name]));
  const orgWide = actor.role === "owner" || actor.role === "admin";
  return all
    .map((u) => {
      const facilityIds = links.filter((l) => l.userId === u.id).map((l) => l.facilityId);
      const t = tokens.find((x) => x.userId === u.id);
      const rehireOnly = u.status === "deactivated" && !!u.deactivatedAt && Date.now() - u.deactivatedAt.getTime() > REHIRE_AFTER_DAYS * 86_400_000;
      return {
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        status: u.status,
        facilityIds,
        facilityNames: facilityIds.map((f) => nameOf.get(f) ?? "Unknown"),
        mfaEnabled: u.mfaEnabled,
        lastSignInAt: u.lastSignInAt,
        deactivatedAt: u.deactivatedAt,
        deactivationReason: u.deactivationReason,
        invite: u.status === "invited" && t ? { purpose: t.purpose, sentAt: t.createdAt, expiresAt: t.expiresAt, expired: t.expiresAt < new Date() } : null,
        canManage: canManage(actor, { id: u.id, role: u.role, facilityIds }),
        rehireOnly,
      };
    })
    .filter((r) => orgWide || r.facilityIds.some((f) => actor.facilityIds.includes(f)));
}

export const inviteSchema = z.object({
  name: z.string().trim().min(2, "Enter the person's full name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid work email."),
  role: z.enum(["owner", "admin", "manager", "nurse", "med_caregiver", "caregiver"]),
  facilityIds: z.array(z.string().uuid()).min(1, "Choose at least one home."),
});

async function issueLink(tx: Tx, actor: Actor, user: { id: string; orgId: string; email: string; name: string }, purpose: "invite" | "reactivate", appUrl: string) {
  await tx.update(accountTokens).set({ cancelledAt: new Date() }).where(and(eq(accountTokens.userId, user.id), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)));
  const token = randomToken();
  const expiresAt = days(INVITE_DAYS);
  await tx.insert(accountTokens).values({ orgId: user.orgId, userId: user.id, purpose, tokenHash: sha256(token), createdBy: actor.id, expiresAt });
  await sendMail(tx, {
    orgId: user.orgId,
    to: user.email,
    subject: purpose === "invite" ? "You're invited to CareHouse One" : "Your CareHouse One account was reactivated",
    body: `Hi ${user.name},\n\nUse this link to set your password and turn on two-step verification. It works once and expires in ${INVITE_DAYS} days.\n\n${appUrl}/invite/${token}`,
  });
  return expiresAt;
}

export async function inviteStaff(tx: Tx, actor: Actor, orgId: string, raw: unknown, appUrl: string): Promise<Result> {
  const parsed = inviteSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };
  const input = parsed.data;
  if (!canInvite(actor, input.role, input.facilityIds)) return { ok: false, error: "You can't add someone with that role or to that home." };
  const homes = await tx.select({ id: facilities.id }).from(facilities).where(inArray(facilities.id, input.facilityIds));
  if (homes.length !== input.facilityIds.length) return { ok: false, error: "One of those homes doesn't exist." };
  const [dup] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.email}`);
  if (dup) return { ok: false, error: "Someone with that email already has an account here." };
  const [u] = await tx.insert(users).values({ orgId, email: input.email, name: input.name, role: input.role, status: "invited" }).returning();
  await tx.insert(userFacilities).values(input.facilityIds.map((facilityId) => ({ orgId, userId: u.id, facilityId })));
  const expiresAt = await issueLink(tx, actor, u, "invite", appUrl);
  await audit(tx, { orgId, actorId: actor.id, action: "invitation_sent", entity: "user", entityId: u.id, details: { role: input.role, facilityIds: input.facilityIds, expiresAt } });
  return { ok: true, message: `Invitation sent to ${input.email}. It expires in ${INVITE_DAYS} days.` };
}

export async function resendInvite(tx: Tx, actor: Actor, userId: string, appUrl: string): Promise<Result> {
  const t = await targetOf(tx, userId);
  if (!t || t.user.status !== "invited") return { ok: false, error: "There's no pending invitation for that person." };
  if (!canManage(actor, t)) return { ok: false, error: "You can't manage that person's invitation." };
  const purpose = t.user.deactivatedAt ? "reactivate" : "invite";
  await issueLink(tx, actor, t.user, purpose, appUrl);
  await audit(tx, { orgId: t.user.orgId, actorId: actor.id, action: "invitation_resent", entity: "user", entityId: t.id });
  return { ok: true, message: `New link sent to ${t.user.email}. The old link no longer works.` };
}

export async function cancelInvite(tx: Tx, actor: Actor, userId: string): Promise<Result> {
  const t = await targetOf(tx, userId);
  if (!t || t.user.status !== "invited") return { ok: false, error: "There's no pending invitation for that person." };
  if (!canManage(actor, t)) return { ok: false, error: "You can't manage that person's invitation." };
  await tx.update(accountTokens).set({ cancelledAt: new Date() }).where(and(eq(accountTokens.userId, t.id), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)));
  if (t.user.deactivatedAt) {
    // A cancelled reactivation leaves the person deactivated, unchanged.
    await tx.update(users).set({ status: "deactivated" }).where(eq(users.id, t.id));
  } else {
    await tx.delete(accountTokens).where(eq(accountTokens.userId, t.id));
    await tx.delete(userFacilities).where(eq(userFacilities.userId, t.id));
    await tx.delete(users).where(eq(users.id, t.id));
  }
  await audit(tx, { orgId: t.user.orgId, actorId: actor.id, action: "invitation_cancelled", entity: "user", entityId: t.id, details: { email: t.user.email } });
  return { ok: true, message: `Invitation for ${t.user.name} cancelled.` };
}

export const deactivateSchema = z.object({
  reason: z.enum(["Resigned", "Employment ended", "Extended leave", "Other"]),
});

export async function deactivateStaff(tx: Tx, actor: Actor, userId: string, raw: unknown): Promise<Result> {
  const parsed = deactivateSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Choose a reason." };
  const t = await targetOf(tx, userId);
  if (!t || t.user.status !== "active") return { ok: false, error: "Only active accounts can be deactivated." };
  if (!canManage(actor, t)) return { ok: false, error: "You can't deactivate that person." };
  if (t.role === "owner") {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "owner"), eq(users.status, "active")));
    if (n <= 1) return { ok: false, error: "The last owner can't be deactivated." };
  }
  await tx.update(users).set({ status: "deactivated", deactivatedAt: new Date(), deactivationReason: parsed.data.reason }).where(eq(users.id, t.id));
  await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, t.id), isNull(sessions.revokedAt)));
  await tx.update(accountTokens).set({ cancelledAt: new Date() }).where(and(eq(accountTokens.userId, t.id), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)));
  await audit(tx, { orgId: t.user.orgId, actorId: actor.id, action: "user_deactivated", entity: "user", entityId: t.id, details: { reason: parsed.data.reason } });
  return { ok: true, message: `${t.user.name} is deactivated and signed out on every device.` };
}

export async function reactivateStaff(tx: Tx, actor: Actor, userId: string, appUrl: string): Promise<Result> {
  const t = await targetOf(tx, userId);
  if (!t || t.user.status !== "deactivated") return { ok: false, error: "Only deactivated accounts can be reactivated." };
  if (!canManage(actor, t)) return { ok: false, error: "You can't reactivate that person." };
  if (t.user.deactivatedAt && Date.now() - t.user.deactivatedAt.getTime() > REHIRE_AFTER_DAYS * 86_400_000) {
    return { ok: false, error: "This person left more than 12 months ago. Invite them as a new hire instead." };
  }
  // Old password and authenticator are never restored: they set both up again.
  await tx.update(users).set({ status: "invited", passwordHash: null, mfaEnabled: false, mfaSecretEnc: null }).where(eq(users.id, t.id));
  await issueLink(tx, actor, t.user, "reactivate", appUrl);
  await audit(tx, { orgId: t.user.orgId, actorId: actor.id, action: "user_reactivated", entity: "user", entityId: t.id });
  return { ok: true, message: `${t.user.name} will get an email to set a new password and two-step verification.` };
}
