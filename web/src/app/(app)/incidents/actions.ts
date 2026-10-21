"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { appUrl, requireUser } from "@/lib/session";
import { addIncidentFollowup, fileIncident } from "@/server/incidents";
import { deliverNow } from "@/server/mailer";

const FIELDS = ["facilityId", "residentId", "type", "severity", "date", "time", "location", "description", "actionTaken", "injury", "injuryDetails", "witnesses"];

export async function fileIncidentAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const raw = Object.fromEntries(FIELDS.map((k) => [k, fd.get(k) ?? undefined]));
  const url = await appUrl();
  const r = await withTenant(await getDb(), me.orgId, (tx) => fileIncident(tx, me, me.orgId, raw, url, new Date()));
  if (!r.ok) return { error: r.error };
  await deliverNow(await getDb());
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
  redirect(`/incidents/${r.data!.id}?filed=1`);
}

export async function incidentFollowupAction(incidentId: string, _: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => addIncidentFollowup(tx, me, incidentId, { kind: fd.get("kind"), details: fd.get("details") ?? undefined }, new Date()));
  revalidatePath(`/incidents/${incidentId}`);
  revalidatePath("/incidents");
  revalidatePath("/dashboard");
  return r.ok ? { message: r.message } : { error: r.error };
}
