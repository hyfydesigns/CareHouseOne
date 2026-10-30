"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/status";
import { getDb, withTenant, type Tx } from "@/db/client";
import type { Actor } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { adjustCount, createOrder, recordFollowup, recordPrnDose, recordScheduledDose, stopOrder } from "@/server/meds";
import { onShiftOnly } from "@/server/shift-guard";
import { createResident, deleteResident, dischargeResident, readmitResident, updateResident } from "@/server/residents";

/** Every care action re-checks the signed-in user and runs inside their organization only. */
async function asMe<T>(fn: (tx: Tx, actor: Actor, orgId: string) => Promise<T>): Promise<T> {
  const me = await requireUser();
  return withTenant(await getDb(), me.orgId, (tx) => fn(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId));
}

const obj = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fd.get(k) ?? undefined]));

export async function addResidentAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor, orgId) =>
    createResident(tx, actor, orgId, obj(fd, RESIDENT_FIELDS)),
  );
  if (!r.ok) return { error: r.error };
  revalidatePath("/residents");
  redirect(`/residents/${r.data!.id}`);
}

const RESIDENT_FIELDS = [
  "facilityId",
  "firstName",
  "lastName",
  "room",
  "dateOfBirth",
  "allergies",
  "diet",
  "codeStatus",
  "guardian",
  "guardianRelationship",
  "guardianPhone",
  "guardianEmail",
  "emergencyName",
  "emergencyRelationship",
  "emergencyPhone",
  "admittedOn",
];

export async function updateResidentAction(residentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => updateResident(tx, actor, residentId, obj(fd, RESIDENT_FIELDS)));
  revalidatePath(`/residents/${residentId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function dischargeAction(residentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => dischargeResident(tx, actor, residentId, obj(fd, ["date", "reason"])));
  revalidatePath(`/residents/${residentId}`);
  revalidatePath("/residents");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function deleteResidentAction(residentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => deleteResident(tx, actor, residentId, obj(fd, ["reason"])));
  if (!r.ok) return { error: r.error };
  revalidatePath("/residents");
  redirect("/residents");
}

export async function readmitAction(residentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => readmitResident(tx, actor, residentId, obj(fd, ["date"])));
  revalidatePath(`/residents/${residentId}`);
  revalidatePath("/residents");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function addOrderAction(residentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const input = {
    ...obj(fd, ["name", "strength", "route", "purpose", "type", "prnReasons", "prnMinIntervalHours", "prnMaxPerDay", "instructions", "prescriber", "packageCode", "countOnHand", "perDose", "startDate", "stopDate"]),
    times: fd.getAll("times").map(String),
    bpCheck: fd.get("bpCheck") === "on",
  };
  const r = await asMe((tx, actor, orgId) => createOrder(tx, actor, orgId, residentId, input, new Date()));
  revalidatePath(`/residents/${residentId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function stopOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => stopOrder(tx, actor, String(fd.get("orderId")), String(fd.get("reason") ?? "")));
  revalidatePath(`/residents/${fd.get("residentId")}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function giveAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) =>
    onShiftOnly(tx, actor, { orderId: fd.get("orderId") }, () =>
      recordScheduledDose(
        tx,
        actor,
        { ...obj(fd, ["orderId", "scheduledFor", "residentCode", "packageCode", "outcome", "reason", "note", "bpSystolic", "bpDiastolic"]), packageConfirmed: fd.get("packageConfirmed") === "on", residentConfirmed: fd.get("residentConfirmed") === "on" },
        new Date(),
      ),
    ),
  );
  if (r.ok) revalidatePath("/meds");
  return r.ok ? { message: r.message } : { error: r.error, stop: "stop" in r && !!r.stop };
}

export async function prnAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) =>
    onShiftOnly(tx, actor, { orderId: fd.get("orderId") }, () =>
      recordPrnDose(tx, actor, { ...obj(fd, ["orderId", "residentCode", "packageCode", "reason", "note"]), packageConfirmed: fd.get("packageConfirmed") === "on", residentConfirmed: fd.get("residentConfirmed") === "on" }, new Date()),
    ),
  );
  if (r.ok) revalidatePath("/meds");
  return r.ok ? { message: r.message } : { error: r.error, stop: "stop" in r && !!r.stop };
}

export async function followupAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => onShiftOnly(tx, actor, { followupId: fd.get("followupId") }, () => recordFollowup(tx, actor, obj(fd, ["followupId", "result", "note"]), new Date())));
  revalidatePath("/meds");
  revalidatePath(`/residents/${fd.get("residentId")}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

/** Owners and admins: add a refill or correct the tablet count. */
export async function adjustCountAction(_: FormState, fd: FormData): Promise<FormState> {
  const r = await asMe((tx, actor) => adjustCount(tx, actor, String(fd.get("orderId")), obj(fd, ["mode", "amount", "reason"])));
  revalidatePath(`/residents/${fd.get("residentId")}`);
  revalidatePath("/dashboard");
  return r.ok ? { message: r.message } : { error: r.error };
}
