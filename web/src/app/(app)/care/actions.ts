"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant, type Tx } from "@/db/client";
import type { Actor } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { addNote, recordVitals, reviewVital, signInShift, signOutShift } from "@/server/care";
import { addDiagnosis, removeDiagnosis } from "@/server/diagnoses";
import type { Result } from "@/server/residents";

async function run(fn: (tx: Tx, actor: Actor, orgId: string) => Promise<Result<unknown>>, paths: string[]): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => fn(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId));
  paths.forEach((p) => revalidatePath(p));
  return r.ok ? { message: r.message } : { error: r.error };
}

const pick = (fd: FormData, keys: string[]) => Object.fromEntries(keys.map((k) => [k, fd.get(k) ?? undefined]));
const residentPaths = (fd: FormData) => [`/residents/${fd.get("residentId")}`, "/vitals", "/notes", "/dashboard"];

export async function vitalsAction(_: FormState, fd: FormData) {
  return run((tx, a) => recordVitals(tx, a, pick(fd, ["residentId", "systolic", "diastolic", "pulse", "temperature", "respirations", "oxygen", "weight", "note"]), new Date()), residentPaths(fd));
}

export async function reviewVitalAction(_: FormState, fd: FormData) {
  return run((tx, a) => reviewVital(tx, a, String(fd.get("vitalId")), String(fd.get("note") ?? "")), ["/dashboard", ...residentPaths(fd)]);
}

export async function noteAction(_: FormState, fd: FormData) {
  return run((tx, a) => addNote(tx, a, pick(fd, ["residentId", "shift", "category", "body", "addendumTo"]), new Date()), residentPaths(fd));
}

export async function addDiagnosisAction(_: FormState, fd: FormData) {
  return run((tx, a) => addDiagnosis(tx, a, pick(fd, ["residentId", "code", "label"])), residentPaths(fd));
}

export async function removeDiagnosisAction(_: FormState, fd: FormData) {
  return run((tx, a) => removeDiagnosis(tx, a, String(fd.get("diagnosisId")), String(fd.get("reason") ?? "")), residentPaths(fd));
}

export async function shiftAction(_: FormState, fd: FormData) {
  const op = fd.get("op");
  return run((tx, a, orgId) => (op === "out" ? signOutShift(tx, a, new Date()) : signInShift(tx, a, orgId, String(fd.get("facilityId")), new Date())), ["/shift"]);
}
