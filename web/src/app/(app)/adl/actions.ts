"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { ADL_ACTIVITIES, recordAdl } from "@/server/adl";

export async function adlAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const entries = Object.fromEntries(Object.keys(ADL_ACTIVITIES).map((a) => [a, String(fd.get(`a_${a}`) ?? "")]));
  const residentId = String(fd.get("residentId") ?? "");
  const r = await withTenant(await getDb(), me.orgId, (tx) => recordAdl(tx, me, { residentId, entries, note: fd.get("note") ?? undefined }, new Date()));
  revalidatePath("/adl");
  revalidatePath(`/residents/${residentId}`);
  revalidatePath("/dashboard");
  return r.ok ? { message: r.message } : { error: r.error };
}
