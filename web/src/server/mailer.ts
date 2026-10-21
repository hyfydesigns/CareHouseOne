import { and, asc, isNull, lt } from "drizzle-orm";
import { eq } from "drizzle-orm";
import type { DB } from "@/db/client";
import { outbox } from "@/db/schema";

export const MAX_ATTEMPTS = 5;

export interface Transport {
  send(m: { from: string; to: string; subject: string; text: string }): Promise<void>;
}

/**
 * SMTP from SMTP_URL (for example smtps://user:password@smtp.provider.com:465), sending as
 * MAIL_FROM. Any provider works; the messages hold only links and never resident details, so
 * the provider doesn't need a BAA. Returns null when email isn't configured (local development).
 */
async function smtpTransport(): Promise<Transport | null> {
  const url = process.env.SMTP_URL;
  if (!url) return null;
  const nodemailer = await import("nodemailer");
  const t = nodemailer.createTransport(url);
  return {
    async send(m) {
      await t.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

/**
 * Sends queued emails. Called right after an action that queued mail (once its transaction has
 * committed) and every few minutes by Cloud Scheduler to retry failures. Runs outside a tenant.
 */
export async function deliverOutbox(db: DB, transport?: Transport | null, limit = 20): Promise<{ sent: number; failed: number }> {
  // The public demo never sends email: its addresses are made up.
  if (process.env.DEMO_MODE === "true") return { sent: 0, failed: 0 };
  const t = transport === undefined ? await smtpTransport() : transport;
  if (!t) return { sent: 0, failed: 0 };
  const from = process.env.MAIL_FROM || "CareHouse One <no-reply@localhost>";
  const rows = await db
    .select()
    .from(outbox)
    .where(and(isNull(outbox.sentAt), lt(outbox.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(outbox.createdAt))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const m of rows) {
    try {
      await t.send({ from, to: m.to, subject: m.subject, text: m.body });
      await db.update(outbox).set({ sentAt: new Date(), attempts: m.attempts + 1, lastError: null }).where(eq(outbox.id, m.id));
      sent++;
    } catch (e) {
      const msg = (e as Error).message.slice(0, 300);
      await db.update(outbox).set({ attempts: m.attempts + 1, lastError: msg }).where(eq(outbox.id, m.id));
      console.error(`[mail] delivery failed (attempt ${m.attempts + 1}): ${msg}`);
      failed++;
    }
  }
  return { sent, failed };
}

/** For actions: send now, but never let an email problem fail the action itself. */
export async function deliverNow(db: DB): Promise<void> {
  try {
    await deliverOutbox(db);
  } catch (e) {
    console.error(`[mail] ${(e as Error).message}`);
  }
}
