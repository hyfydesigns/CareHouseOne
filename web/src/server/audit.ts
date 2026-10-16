import { auditLog, outbox } from "@/db/schema";
import type { DB, Tx } from "@/db/client";

type Exec = DB | Tx;

export async function audit(
  db: Exec,
  e: { orgId: string; actorId: string | null; action: string; entity: string; entityId?: string | null; details?: Record<string, unknown> },
): Promise<void> {
  await db.insert(auditLog).values({
    orgId: e.orgId,
    actorId: e.actorId,
    action: e.action,
    entity: e.entity,
    entityId: e.entityId ?? null,
    details: e.details ?? {},
  });
}

/**
 * Queues an email in the outbox; mailer.ts delivers it once the transaction has committed.
 * Messages never contain resident information, only links into the app. In local development
 * (no SMTP_URL) they're also printed to the server log so the links can be followed. Never in
 * production: reset and invitation links are secrets.
 */
export async function sendMail(db: Exec, m: { orgId: string | null; to: string; subject: string; body: string }): Promise<void> {
  await db.insert(outbox).values({ orgId: m.orgId, to: m.to, subject: m.subject, body: m.body });
  if (process.env.NODE_ENV === "development" && !process.env.SMTP_URL) {
    console.info(`[mail] to=${m.to} subject="${m.subject}"\n${m.body}`);
  }
}
