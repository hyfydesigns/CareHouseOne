"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import type { FormDef, FormKind } from "@/lib/onboarding-forms";
import { appUrl, clientIp, requireUser, userAgent } from "@/lib/session";
import { admitOnboarding, cancelOnboarding, resendLink, reviewItem, staffSaveValues, staffSign, startOnboarding } from "@/server/onboarding";
import { addMissingStarters, createForm, moveForm, saveForm, setFormHidden } from "@/server/onboarding-forms";
import { renderOnboardingPdf } from "@/server/onboarding-pdf";

const actorOf = (me: Awaited<ReturnType<typeof requireUser>>) => ({ id: me.id, role: me.role, facilityIds: me.facilityIds });

export async function createFormAction(kind: FormKind): Promise<void> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => createForm(tx, actorOf(me), me.orgId, kind === "upload" ? "upload" : "form"));
  if (r.ok) redirect(`/onboarding/forms/${r.data!.id}`);
}

export async function saveFormAction(id: string, form: FormDef): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => saveForm(tx, actorOf(me), id, form));
  revalidatePath("/onboarding/forms");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function hideFormAction(id: string, hidden: boolean): Promise<void> {
  const me = await requireUser();
  await withTenant(await getDb(), me.orgId, (tx) => setFormHidden(tx, actorOf(me), id, hidden));
  revalidatePath("/onboarding/forms");
}

export async function moveFormAction(id: string, dir: -1 | 1): Promise<void> {
  const me = await requireUser();
  await withTenant(await getDb(), me.orgId, (tx) => moveForm(tx, actorOf(me), id, dir));
  revalidatePath("/onboarding/forms");
}

export async function addStartersAction(): Promise<void> {
  const me = await requireUser();
  await withTenant(await getDb(), me.orgId, (tx) => addMissingStarters(tx, actorOf(me), me.orgId));
  revalidatePath("/onboarding/forms");
}

// ---------------------------------------------------------------- onboardings

export async function startOnboardingAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const url = await appUrl();
  const r = await withTenant(await getDb(), me.orgId, (tx) => startOnboarding(tx, actorOf(me), me.orgId, Object.fromEntries(fd), url));
  if (!r.ok) return { error: r.error };
  redirect(`/onboarding/${r.data!.id}`);
}

export async function resendLinkAction(packetId: string): Promise<FormState> {
  const me = await requireUser();
  const url = await appUrl();
  const r = await withTenant(await getDb(), me.orgId, (tx) => resendLink(tx, actorOf(me), packetId, url));
  revalidatePath(`/onboarding/${packetId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function cancelOnboardingAction(packetId: string): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => cancelOnboarding(tx, actorOf(me), packetId));
  revalidatePath("/onboarding");
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function staffSaveAction(packetId: string, itemId: string, values: Record<string, string>): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => staffSaveValues(tx, actorOf(me), packetId, itemId, values));
  revalidatePath(`/onboarding/${packetId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function staffSignAction(packetId: string, itemId: string, blockId: string, sig: { name: string; method: string; image?: string; consent: boolean }): Promise<FormState> {
  const me = await requireUser();
  const meta = { ip: await clientIp(), userAgent: await userAgent() };
  const r = await withTenant(await getDb(), me.orgId, (tx) => staffSign(tx, actorOf(me), packetId, itemId, blockId, sig, meta));
  revalidatePath(`/onboarding/${packetId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function reviewAction(packetId: string, itemId: string, decision: "approve" | "changes", note: string): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => reviewItem(tx, actorOf(me), packetId, itemId, decision, note));
  revalidatePath(`/onboarding/${packetId}`);
  return r.ok ? { message: r.message } : { error: r.error };
}

export async function admitAction(packetId: string, _: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const url = await appUrl();
  const r = await withTenant(await getDb(), me.orgId, (tx) => admitOnboarding(tx, actorOf(me), packetId, Object.fromEntries(fd) as Record<string, string>, renderOnboardingPdf, url));
  if (!r.ok) return { error: r.error };
  revalidatePath("/onboarding");
  revalidatePath("/residents");
  redirect(`/residents/${r.data!.residentId}?tab=documents`);
}
