import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type DB } from "@/db/client";
import { progressNotes, vitals } from "@/db/schema";
import { addNote, recordVitals } from "./care";
import type { SessionUser } from "./auth";

/** Entries older than this are refused: a late record needs a person to look at it, not a silent sync. */
export const MAX_OFFLINE_HOURS = 72;
const MAX_ITEMS = 50;

const itemSchema = z.object({
  clientId: z.string().uuid(),
  kind: z.enum(["vitals", "note"]),
  userId: z.string().uuid(),
  createdAt: z.coerce.date(),
  payload: z.record(z.string(), z.unknown()),
});

export type SyncOutcome = { clientId: string; status: "saved" | "duplicate" | "rejected"; error?: string; message?: string };

/**
 * Saves entries queued on a tablet while it was offline. Each entry is its own transaction, keeps
 * the time it was taken, and is matched on its clientId so a repeated upload is a no-op.
 */
export async function syncEntries(db: DB, me: SessionUser, raw: unknown, now: Date): Promise<SyncOutcome[]> {
  const list = z.array(z.unknown()).max(MAX_ITEMS).safeParse(raw);
  if (!list.success) return [];
  const out: SyncOutcome[] = [];
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  for (const rawItem of list.data) {
    const p = itemSchema.safeParse(rawItem);
    const clientId = typeof (rawItem as { clientId?: unknown })?.clientId === "string" ? String((rawItem as { clientId: string }).clientId) : "";
    if (!p.success) {
      out.push({ clientId, status: "rejected", error: "This entry is damaged and can't be saved." });
      continue;
    }
    const it = p.data;
    if (it.userId !== me.id) {
      out.push({ clientId, status: "rejected", error: "This entry was made by someone else. They need to sign in on this tablet to send it." });
      continue;
    }
    const age = now.getTime() - it.createdAt.getTime();
    if (age > MAX_OFFLINE_HOURS * 3_600_000) {
      out.push({ clientId, status: "rejected", error: `This entry is more than ${MAX_OFFLINE_HOURS} hours old. Write it up again with a late-entry note.` });
      continue;
    }
    const takenAt = age < 0 ? now : it.createdAt;
    const table = it.kind === "vitals" ? vitals : progressNotes;
    try {
      const r = await withTenant(db, me.orgId, async (tx) => {
        const [dup] = await tx.select({ id: table.id }).from(table).where(and(eq(table.orgId, me.orgId), eq(table.clientId, it.clientId)));
        if (dup) return null;
        return it.kind === "vitals"
          ? recordVitals(tx, actor, it.payload, takenAt, { clientId: it.clientId })
          : addNote(tx, actor, it.payload, takenAt, { clientId: it.clientId });
      });
      if (!r) out.push({ clientId, status: "duplicate" });
      else if (r.ok) out.push({ clientId, status: "saved", message: r.message });
      else out.push({ clientId, status: "rejected", error: r.error });
    } catch (e) {
      // Two uploads of the same entry at once: the unique index stops the second one.
      if (String((e as { cause?: { code?: string }; code?: string })?.cause?.code ?? (e as { code?: string })?.code) === "23505") out.push({ clientId, status: "duplicate" });
      else throw e;
    }
  }
  return out;
}
