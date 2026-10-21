"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { clearCookie, DEVICE_COOKIE, requireUser, setDeviceCookie } from "@/lib/session";
import { adminLockedMessage } from "@/server/billing";
import { registerDevice, revokeDevice, updateDeviceHomes } from "@/server/devices";
import { setResidentCheck } from "@/server/org";

export async function residentCheckAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const locked = await withTenant(await getDb(), me.orgId, adminLockedMessage);
  if (locked) return { error: locked };
  const r = await withTenant(await getDb(), me.orgId, (tx) => setResidentCheck(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId, fd.get("residentCheck")));
  revalidatePath("/settings");
  return r.ok ? { message: r.message } : { error: r.error };
}

/** Registers the browser this is clicked in as one of the home tablets. */
export async function registerDeviceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const locked = await withTenant(await getDb(), me.orgId, adminLockedMessage);
  if (locked) return { error: locked };
  const r = await withTenant(await getDb(), me.orgId, (tx) => registerDevice(tx, me, me.orgId, { facilityIds: fd.getAll("facilityIds"), name: fd.get("name") }));
  if (!r.ok) return { error: r.error };
  await setDeviceCookie(r.data!.token);
  revalidatePath("/settings");
  return { message: `${r.message} Sign out and back in on it to use it as a shared tablet.` };
}

export async function deviceHomesAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const locked = await withTenant(await getDb(), me.orgId, adminLockedMessage);
  if (locked) return { error: locked };
  const r = await withTenant(await getDb(), me.orgId, (tx) => updateDeviceHomes(tx, me, String(fd.get("deviceId")), fd.getAll("facilityIds")));
  revalidatePath("/settings");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function revokeDeviceAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => revokeDevice(tx, me, String(fd.get("deviceId"))));
  revalidatePath("/settings");
  return r.ok ? { message: r.message } : { error: r.error };
}

/** Removes the tablet mark from this browser only (the registration stays until it's removed). */
export async function forgetThisDeviceAction(): Promise<FormState> {
  await requireUser();
  await clearCookie(DEVICE_COOKIE);
  revalidatePath("/settings");
  return { message: "This browser is no longer marked as a tablet." };
}
