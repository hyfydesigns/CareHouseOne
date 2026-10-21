import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { facilities, staffCertifications, users } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { addDays, isDate, localDate } from "@/lib/time";
import { audit, sendMail } from "./audit";
import type { Result } from "./residents";

export const CERT_KINDS = {
  med_cert: "Medication administration certification",
  cpr: "CPR",
  first_aid: "First aid",
  abuse_neglect: "Abuse and neglect training",
  orientation: "Orientation",
  tb_test: "TB test",
  background_check: "Background check",
  other: "Other",
} as const;
export type CertKind = keyof typeof CERT_KINDS;

/** Reminders start this many days before something expires. */
export const EXPIRING_DAYS = 30;

export type CertStatus = "expired" | "expiring" | "current" | "no_expiry";

export function certStatus(expiresOn: string | null, today: string): CertStatus {
  if (!expiresOn) return "no_expiry";
  if (expiresOn < today) return "expired";
  if (expiresOn <= addDays(today, EXPIRING_DAYS)) return "expiring";
  return "current";
}

export const certName = (c: { kind: string; label: string | null }) => (c.kind === "other" ? (c.label ?? "Other") : CERT_KINDS[c.kind as CertKind] ?? c.kind);

const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const optDate = z.string().trim().optional().refine((v) => !v || isDate(v), "Enter dates as YYYY-MM-DD.").transform((v) => v || null);

const certSchema = z.object({
  userId: z.string().uuid("Choose the person."),
  kind: z.enum(Object.keys(CERT_KINDS) as [CertKind, ...CertKind[]], { message: "Choose the training or certification." }),
  label: opt(120),
  issuedOn: optDate,
  expiresOn: optDate,
  notes: opt(500),
});

/** Owners and admins keep the training records. */
export async function addCertification(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins keep training records." };
  const p = certSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  if (d.kind === "other" && !d.label) return { ok: false, error: "Name the training." };
  if (d.issuedOn && d.expiresOn && d.expiresOn < d.issuedOn) return { ok: false, error: "The expiry date is before the date it was issued." };
  const [person] = await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, d.userId));
  if (!person) return { ok: false, error: "Choose the person." };
  const [row] = await tx.insert(staffCertifications).values({ orgId, ...d, label: d.kind === "other" ? d.label : null, recordedBy: actor.id }).returning();
  await audit(tx, { orgId, actorId: actor.id, action: "certification_added", entity: "user", entityId: person.id, details: { certificationId: row.id, kind: d.kind, expiresOn: d.expiresOn } });
  return { ok: true, message: `${certName(row)} added for ${person.name}.` };
}

/** Entered by mistake or superseded by a renewal. Kept, marked removed. */
export async function removeCertification(tx: Tx, actor: Actor, id: string): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins keep training records." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Not found." };
  const [c] = await tx.select().from(staffCertifications).where(and(eq(staffCertifications.id, id), isNull(staffCertifications.removedAt)));
  if (!c) return { ok: false, error: "That record is already removed." };
  await tx.update(staffCertifications).set({ removedAt: new Date(), removedBy: actor.id }).where(eq(staffCertifications.id, c.id));
  await audit(tx, { orgId: c.orgId, actorId: actor.id, action: "certification_removed", entity: "user", entityId: c.userId, details: { certificationId: c.id } });
  return { ok: true, message: `${certName(c)} removed.` };
}

/** Everyone's current records with their status, for the Training page. */
export async function trainingOverview(tx: Tx, today: string) {
  const people = await tx
    .select({ id: users.id, name: users.name, role: users.role })
    .from(users)
    .where(inArray(users.status, ["active", "invited"]))
    .orderBy(asc(users.name));
  const certs = await tx.select().from(staffCertifications).where(isNull(staffCertifications.removedAt)).orderBy(asc(staffCertifications.expiresOn));
  return people.map((p) => {
    const mine = certs.filter((c) => c.userId === p.id).map((c) => ({ ...c, status: certStatus(c.expiresOn, today) }));
    return { ...p, certs: mine, worst: mine.some((c) => c.status === "expired") ? "expired" : mine.some((c) => c.status === "expiring") ? "expiring" : "ok" };
  });
}

/** A med-certified caregiver whose medication certification on file has expired (and none is current). */
export async function medCertExpired(tx: Tx, userId: string, today: string): Promise<boolean> {
  const certs = await tx
    .select({ expiresOn: staffCertifications.expiresOn })
    .from(staffCertifications)
    .where(and(eq(staffCertifications.userId, userId), eq(staffCertifications.kind, "med_cert"), isNull(staffCertifications.removedAt)));
  return certs.length > 0 && certs.every((c) => certStatus(c.expiresOn, today) === "expired");
}

/**
 * From the cron job: email owners and admins (and the person) once when something is within 30
 * days of expiring, and once when it has expired. Names and the training only; nothing about residents.
 */
export async function remindCertifications(db: DB, now: Date): Promise<number> {
  const rows = await db
    .select({ c: staffCertifications, name: users.name, email: users.email, status: users.status })
    .from(staffCertifications)
    .innerJoin(users, eq(users.id, staffCertifications.userId))
    .where(and(isNull(staffCertifications.removedAt), isNotNull(staffCertifications.expiresOn)));
  const tzByOrg = new Map<string, string>();
  let sent = 0;
  for (const { c, name, email, status } of rows) {
    if (status === "deactivated") continue;
    if (!tzByOrg.has(c.orgId)) {
      const [h] = await db.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.orgId, c.orgId)).limit(1);
      tzByOrg.set(c.orgId, h?.tz ?? "America/Chicago");
    }
    const today = localDate(now, tzByOrg.get(c.orgId)!);
    const st = certStatus(c.expiresOn, today);
    const due = st === "expired" ? !c.remindedExpiredAt : st === "expiring" ? !c.remindedSoonAt && !c.remindedExpiredAt : false;
    if (!due) continue;
    const what = certName(c);
    const subject = st === "expired" ? `${name}'s ${what} has expired` : `${name}'s ${what} expires on ${c.expiresOn}`;
    const body =
      st === "expired"
        ? `${name}'s ${what} expired on ${c.expiresOn}.${c.kind === "med_cert" ? " They shouldn't give medications until it's renewed." : ""} Add the renewal in CareHouse One under Staff > Training.`
        : `${name}'s ${what} expires on ${c.expiresOn}. Plan the renewal, then add it in CareHouse One under Staff > Training.`;
    const reviewers = await db.select({ email: users.email }).from(users).where(and(eq(users.orgId, c.orgId), inArray(users.role, ["owner", "admin"]), eq(users.status, "active")));
    for (const to of new Set([email, ...reviewers.map((r) => r.email)])) await sendMail(db, { orgId: c.orgId, to, subject, body });
    await db.update(staffCertifications).set(st === "expired" ? { remindedExpiredAt: now } : { remindedSoonAt: now }).where(eq(staffCertifications.id, c.id));
    sent++;
  }
  return sent;
}
