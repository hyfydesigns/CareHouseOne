"use server";

import { revalidatePath } from "next/cache";
import { getDb, withTenant, type Tx } from "@/db/client";
import type { Actor } from "@/lib/permissions";
import { appUrl, requireUser } from "@/lib/session";
import { deliverNow } from "@/server/mailer";
import { cancelInvite, deactivateStaff, inviteStaff, reactivateStaff, resendInvite, type Result } from "@/server/staff";

export type StaffState = { error?: string; message?: string };

/** Every staff change re-checks the signed-in user and runs inside their organization only. */
async function run(fn: (tx: Tx, actor: Actor, orgId: string) => Promise<Result>): Promise<StaffState> {
  const me = await requireUser();
  const db = await getDb();
  const r = await withTenant(db, me.orgId, (tx) => fn(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId));
  if (r.ok) await deliverNow(db);
  revalidatePath("/staff");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function inviteAction(_: StaffState, fd: FormData): Promise<StaffState> {
  const url = await appUrl();
  return run((tx, actor, orgId) =>
    inviteStaff(tx, actor, orgId, { name: fd.get("name"), email: fd.get("email"), role: fd.get("role"), facilityIds: fd.getAll("facilityIds") }, url),
  );
}

export async function staffAction(_: StaffState, fd: FormData): Promise<StaffState> {
  const op = String(fd.get("op"));
  const userId = String(fd.get("userId"));
  const url = await appUrl();
  switch (op) {
    case "resend":
      return run((tx, actor) => resendInvite(tx, actor, userId, url));
    case "cancel":
      return run((tx, actor) => cancelInvite(tx, actor, userId));
    case "deactivate":
      return run((tx, actor) => deactivateStaff(tx, actor, userId, { reason: fd.get("reason") }));
    case "reactivate":
      return run((tx, actor) => reactivateStaff(tx, actor, userId, url));
    default:
      return { error: "Unknown action." };
  }
}
