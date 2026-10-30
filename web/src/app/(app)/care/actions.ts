"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/status";
import { getDb, withTenant, type Tx } from "@/db/client";
import type { Actor } from "@/lib/permissions";
import { clearCookie, readCookie, requireUser, SESSION_COOKIE } from "@/lib/session";
import { signOut } from "@/server/auth";
import { onShiftOnly } from "@/server/shift-guard";
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
  return run((tx, a) => onShiftOnly(tx, a, { residentId: fd.get("residentId") }, () => recordVitals(tx, a, pick(fd, ["residentId", "systolic", "diastolic", "pulse", "temperature", "bloodSugar", "bpPosition", "oxygen", "weight", "note"]), new Date())), residentPaths(fd));
}

export async function reviewVitalAction(_: FormState, fd: FormData) {
  return run((tx, a) => reviewVital(tx, a, String(fd.get("vitalId")), String(fd.get("note") ?? "")), ["/dashboard", ...residentPaths(fd)]);
}

/** Saves the note; returns its id so the form can then upload any photos or files to it. */
export async function noteAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) =>
    onShiftOnly(tx, me, { residentId: fd.get("residentId") }, () => addNote(tx, me, pick(fd, ["residentId", "shift", "category", "body", "addendumTo"]), new Date())),
  );
  residentPaths(fd).forEach((p) => revalidatePath(p));
  return r.ok ? { message: r.message, id: r.data?.id } : { error: r.error };
}

export async function addDiagnosisAction(_: FormState, fd: FormData) {
  return run((tx, a) => addDiagnosis(tx, a, pick(fd, ["residentId", "code", "label"])), residentPaths(fd));
}

export async function removeDiagnosisAction(_: FormState, fd: FormData) {
  return run((tx, a) => removeDiagnosis(tx, a, String(fd.get("diagnosisId")), String(fd.get("reason") ?? "")), residentPaths(fd));
}

/** The pages that ask a caregiver to start their shift, so they refresh once it has started or ended. */
const SHIFT_PAGES = ["/shift", "/dashboard", "/meds", "/vitals", "/notes", "/adl"];

/**
 * Start or end a shift. Ending a shift on a home tablet also signs the caregiver out of it, so the
 * next person signs in as themselves.
 */
export async function shiftAction(_: FormState, fd: FormData) {
  const op = fd.get("op");
  const me = await requireUser();
  if (op !== "out") {
    return run((tx, a, orgId) => signInShift(tx, a, orgId, me.device?.facilityIds ?? null, String(fd.get("facilityId") ?? "") || null, new Date()), SHIFT_PAGES);
  }
  const r = await run((tx, a) => signOutShift(tx, a, new Date()), SHIFT_PAGES);
  if (r.error || !me.device) return r;
  const token = await readCookie(SESSION_COOKIE);
  if (token) await signOut(await getDb(), token);
  await clearCookie(SESSION_COOKIE);
  redirect("/sign-in?ended=1");
}
