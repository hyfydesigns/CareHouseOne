"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { recordAdl } from "@/server/adl";

export async function adlAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  // Each activity's choice arrives as a_<activity key>; the server checks the keys against the organization's list.
  const entries = Object.fromEntries([...fd.entries()].filter(([k]) => k.startsWith("a_")).map(([k, v]) => [k.slice(2), String(v)]));
  const residentId = String(fd.get("residentId") ?? "");
  const r = await withTenant(await getDb(), me.orgId, (tx) => recordAdl(tx, me, { residentId, entries, note: fd.get("note") ?? undefined }, new Date()));
  revalidatePath("/adl");
  revalidatePath(`/residents/${residentId}`);
  revalidatePath("/dashboard");
  return r.ok ? { message: r.message } : { error: r.error };
}
