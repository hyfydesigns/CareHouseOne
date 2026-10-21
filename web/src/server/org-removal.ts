import { and, asc, count, eq, isNull, sql } from "drizzle-orm";
import type { DB, Tx } from "@/db/client";
import {
  accountTokens,
  administrations,
  auditLog,
  devicePins,
  deviceFacilities,
  devices,
  facilities,
  incidents,
  medicationOrders,
  organizations,
  outbox,
  prnFollowups,
  progressNotes,
  residentDiagnoses,
  residents,
  sessions,
  shiftPunches,
  subscriptions,
  userFacilities,
  users,
  vitalReviews,
  vitals,
} from "@/db/schema";

export interface OrgListing {
  id: string;
  name: string;
  createdAt: Date;
  owners: string[];
  homes: number;
  staff: number;
  residents: number;
  paypalSubscription: string | null;
}

/** Every organization, oldest first, with what's needed to recognise a test one. */
export async function listOrganizations(db: DB): Promise<OrgListing[]> {
  const orgs = await db.select().from(organizations).orderBy(asc(organizations.createdAt));
  const out: OrgListing[] = [];
  for (const o of orgs) {
    const owners = await db.select({ email: users.email }).from(users).where(and(eq(users.orgId, o.id), eq(users.role, "owner")));
    const [{ homes }] = await db.select({ homes: count() }).from(facilities).where(eq(facilities.orgId, o.id));
    const [{ staff }] = await db.select({ staff: count() }).from(users).where(eq(users.orgId, o.id));
    const [{ n }] = await db.select({ n: count() }).from(residents).where(eq(residents.orgId, o.id));
    const [sub] = await db.select({ id: subscriptions.paypalSubscriptionId }).from(subscriptions).where(eq(subscriptions.orgId, o.id));
    out.push({ id: o.id, name: o.name, createdAt: o.createdAt, owners: owners.map((x) => x.email), homes, staff, residents: n, paypalSubscription: sub?.id ?? null });
  }
  return out;
}

/** PayPal sign-ups that never set up an organization. */
export async function listUnclaimedSubscriptions(db: DB) {
  return db
    .select({ id: subscriptions.paypalSubscriptionId, payer: subscriptions.payerEmail, status: subscriptions.status, createdAt: subscriptions.createdAt })
    .from(subscriptions)
    .where(isNull(subscriptions.orgId))
    .orderBy(asc(subscriptions.createdAt));
}

/** Tables whose rows are care records. Any row here means the organization isn't a test one. */
const CARE_TABLES = [residents, medicationOrders, administrations, prnFollowups, vitals, vitalReviews, progressNotes, residentDiagnoses, incidents] as const;

/**
 * Permanently removes a TEST organization: one that has never had a resident or any care record.
 * The caller must pass the organization's exact name as confirmation. Its audit log entries go
 * too: the append-only trigger is switched off for this one transaction only (it can't be left
 * off: if anything fails, the whole transaction, trigger change included, is rolled back).
 */
export async function removeTestOrganization(db: DB, orgId: string, confirmName: string): Promise<{ ok: true; removed: Record<string, number> } | { ok: false; error: string }> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, error: "No organization with that ID." };
  if (confirmName !== org.name) return { ok: false, error: `The name doesn't match. Type it exactly: ${org.name}` };
  for (const t of CARE_TABLES) {
    const [{ n }] = await db.select({ n: count() }).from(t).where(eq(t.orgId, orgId));
    if (n > 0) return { ok: false, error: `"${org.name}" has care records, so it isn't a test organization. Refusing to delete it.` };
  }
  const removed: Record<string, number> = {};
  await db.transaction(async (tx: Tx) => {
    const del = async (name: string, table: typeof shiftPunches | typeof devicePins | typeof sessions | typeof deviceFacilities | typeof devices | typeof accountTokens | typeof userFacilities | typeof outbox | typeof subscriptions | typeof auditLog | typeof users | typeof facilities) => {
      const rows = await tx.delete(table).where(eq(table.orgId, orgId)).returning();
      removed[name] = rows.length;
    };
    await del("shift punches", shiftPunches);
    await del("tablet PINs", devicePins);
    await del("sessions", sessions);
    await del("tablet homes", deviceFacilities);
    await del("tablets", devices);
    await del("invitation and reset links", accountTokens);
    await del("home assignments", userFacilities);
    await del("emails", outbox);
    await del("subscriptions", subscriptions);
    await tx.execute(sql`alter table audit_log disable trigger audit_log_no_change`);
    await del("audit log entries", auditLog);
    await tx.execute(sql`alter table audit_log enable trigger audit_log_no_change`);
    await del("staff accounts", users);
    await del("homes", facilities);
    await tx.delete(organizations).where(eq(organizations.id, orgId));
    removed.organizations = 1;
  });
  return { ok: true, removed };
}

/** Removes a PayPal sign-up that never became an organization (cancel it in PayPal too). */
export async function removeUnclaimedSubscription(db: DB, paypalSubscriptionId: string): Promise<boolean> {
  const rows = await db
    .delete(subscriptions)
    .where(and(eq(subscriptions.paypalSubscriptionId, paypalSubscriptionId), isNull(subscriptions.orgId)))
    .returning();
  return rows.length === 1;
}
