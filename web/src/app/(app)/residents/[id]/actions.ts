"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { removeDocument } from "@/server/documents";

export async function removeDocumentAction(documentId: string, reason: string): Promise<FormState> {
  const me = await requireUser();
  const r = await withTenant(await getDb(), me.orgId, (tx) => removeDocument(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, documentId, reason));
  revalidatePath("/residents");
  return r.ok ? { message: r.message } : { error: r.error };
}
