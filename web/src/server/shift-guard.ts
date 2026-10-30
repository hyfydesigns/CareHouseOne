import { and, eq, isNull } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { facilities, medicationOrders, prnFollowups, residents, shiftPunches } from "@/db/schema";
import { CAREGIVER_ROLES, type Actor } from "@/lib/permissions";

/**
 * Caregivers record care (doses, follow-ups, vital signs, notes, daily care) only while they're
 * on shift at the resident's home, so every entry falls inside a shift on the timesheet. Owners and
 * admins aren't on the clock and are never blocked. Incident reports are never blocked either.
 */
export async function notOnShift(tx: Tx, actor: Actor, target: { residentId?: unknown; orderId?: unknown; followupId?: unknown }): Promise<string | null> {
  if (!CAREGIVER_ROLES.includes(actor.role)) return null;
  const facilityId = await homeOf(tx, target);
  if (!facilityId) return null; // unknown resident: the record function gives the proper error
  const [open] = await tx.select({ facilityId: shiftPunches.facilityId, home: facilities.name }).from(shiftPunches).innerJoin(facilities, eq(facilities.id, shiftPunches.facilityId)).where(and(eq(shiftPunches.userId, actor.id), isNull(shiftPunches.signedOutAt)));
  if (open?.facilityId === facilityId) return null;
  if (open) return `You're on shift at ${open.home}. End that shift, then start one at this resident's home.`;
  return "Start your shift first: tap Start shift at the top of the screen.";
}

/** Runs a caregiver's save only when they're on shift (see notOnShift). */
export async function onShiftOnly<R>(tx: Tx, actor: Actor, target: Parameters<typeof notOnShift>[2], save: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  const blocked = await notOnShift(tx, actor, target);
  return blocked ? { ok: false, error: blocked } : save();
}

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

async function homeOf(tx: Tx, t: { residentId?: unknown; orderId?: unknown; followupId?: unknown }): Promise<string | null> {
  if (isId(t.residentId)) {
    const [r] = await tx.select({ f: residents.facilityId }).from(residents).where(eq(residents.id, t.residentId));
    return r?.f ?? null;
  }
  if (isId(t.orderId)) {
    const [r] = await tx.select({ f: residents.facilityId }).from(medicationOrders).innerJoin(residents, eq(residents.id, medicationOrders.residentId)).where(eq(medicationOrders.id, t.orderId));
    return r?.f ?? null;
  }
  if (isId(t.followupId)) {
    const [r] = await tx.select({ f: residents.facilityId }).from(prnFollowups).innerJoin(residents, eq(residents.id, prnFollowups.residentId)).where(eq(prnFollowups.id, t.followupId));
    return r?.f ?? null;
  }
  return null;
}
