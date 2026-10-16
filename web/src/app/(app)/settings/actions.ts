"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { setResidentCheck } from "@/server/org";

export async function residentCheckAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => setResidentCheck(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, me.orgId, fd.get("residentCheck")));
  revalidatePath("/settings");
  return r.ok ? { message: r.message } : { error: r.error };
}
