"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant, type Tx } from "@/db/client";
import type { Actor } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { recordAppointmentOutcome, rescheduleAppointment, scheduleAppointment } from "@/server/appointments";
import { addHandoff, recordSafetyCheck } from "@/server/operations";
import type { Result } from "@/server/residents";
import { addCertification, removeCertification } from "@/server/training";

async function run(fn: (tx: Tx, actor: Actor, orgId: string) => Promise<Result<unknown>>, paths: string[]): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => fn(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId));
  paths.forEach((p) => revalidatePath(p));
  return r.ok ? { message: r.message } : { error: r.error };
}

const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fd.get(k) ?? undefined]));

export async function handoffAction(_: FormState, fd: FormData) {
  return run((tx, a, orgId) => addHandoff(tx, a, orgId, pick(fd, ["facilityId", "body"]), new Date()), ["/shift", "/meds"]);
}

export async function safetyAction(_: FormState, fd: FormData) {
  return run((tx, a, orgId) => recordSafetyCheck(tx, a, orgId, pick(fd, ["facilityId", "kind", "date", "time", "participants", "durationMinutes", "issues"]), new Date()), ["/safety", "/dashboard"]);
}

const APPT = ["date", "time", "provider", "purpose", "location", "notes"];

export async function scheduleAppointmentAction(residentId: string, _: FormState, fd: FormData) {
  return run((tx, a) => scheduleAppointment(tx, a, residentId, pick(fd, APPT)), [`/residents/${residentId}`, "/dashboard", "/meds"]);
}

export async function rescheduleAppointmentAction(id: string, residentId: string, _: FormState, fd: FormData) {
  return run((tx, a) => rescheduleAppointment(tx, a, id, pick(fd, APPT)), [`/residents/${residentId}`, "/dashboard", "/meds"]);
}

export async function appointmentOutcomeAction(id: string, residentId: string, _: FormState, fd: FormData) {
  return run((tx, a) => recordAppointmentOutcome(tx, a, id, pick(fd, ["status", "outcome", "followUp"])), [`/residents/${residentId}`, "/dashboard", "/meds"]);
}

export async function addCertificationAction(_: FormState, fd: FormData) {
  return run((tx, a, orgId) => addCertification(tx, a, orgId, pick(fd, ["userId", "kind", "label", "issuedOn", "expiresOn", "notes"])), ["/staff/training", "/dashboard"]);
}

export async function removeCertificationAction(id: string) {
  return run((tx, a) => removeCertification(tx, a, id), ["/staff/training", "/dashboard"]);
}
