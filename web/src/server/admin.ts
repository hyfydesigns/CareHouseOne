import { and, count, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import {
  accountTokens,
  adminAudit,
  billingInvoices,
  contracts,
  devices,
  facilities,
  leads,
  organizations,
  residents,
  subscriptions,
  users,
  type BillingInvoice,
  type Contract,
  type Lead,
  type Subscription,
} from "@/db/schema";
import { cycleOn, dayIn } from "@/lib/billing-cycle";
import { randomToken, sha256 } from "@/lib/crypto";
import { adminLog } from "./admin-auth";
import { audit, sendMail } from "./audit";
import { INVITE_DAYS } from "./auth";
import { billingState, scheduleOf, type BillingState } from "./billing";
import { provisionOrganization } from "./provision";

/**
 * What the admin site shows about clients. Organization-level only: homes, staff accounts,
 * billing and contracts, never anything about residents (the resident count is a number).
 */

export interface ClientRow {
  id: string;
  name: string;
  createdAt: Date;
  homes: number;
  staff: number;
  invited: number;
  tablets: number;
  ownerStatus: "active" | "invited" | "none";
  lastSignInAt: Date | null;
  billing: BillingState;
  method: "paypal" | "invoice" | null;
  owed: number;
  late: boolean;
  contract: "signed" | "sent" | "none";
}

const byOrg = <T extends { orgId: string | null }>(rows: T[]) => new Map(rows.map((r) => [r.orgId!, r]));

export async function listClients(db: DB, now = new Date()): Promise<ClientRow[]> {
  const orgs = await db.select().from(organizations).orderBy(organizations.name);
  const homes = byOrg(await db.select({ orgId: facilities.orgId, n: count() }).from(facilities).groupBy(facilities.orgId));
  const staff = await db.select({ orgId: users.orgId, status: users.status, role: users.role, n: count(), last: max(users.lastSignInAt) }).from(users).groupBy(users.orgId, users.status, users.role);
  const tablets = byOrg(await db.select({ orgId: devices.orgId, n: count() }).from(devices).where(isNull(devices.revokedAt)).groupBy(devices.orgId));
  const subs = byOrg(await db.select().from(subscriptions).where(sql`${subscriptions.orgId} is not null`));
  const unpaid = await db.select().from(billingInvoices).where(isNull(billingInvoices.paidAt));
  const signed = await db.select({ orgId: contracts.orgId, status: contracts.status }).from(contracts).where(inArray(contracts.status, ["sent", "signed"]));
  return orgs.map((o) => {
    const mine = staff.filter((s) => s.orgId === o.id);
    const owners = mine.filter((s) => s.role === "owner");
    const sub = (subs.get(o.id) as Subscription | undefined) ?? null;
    const open = unpaid.filter((i) => i.orgId === o.id);
    const cs = signed.filter((c) => c.orgId === o.id);
    const lasts = mine.map((s) => s.last).filter((d): d is Date => !!d);
    return {
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      homes: homes.get(o.id)?.n ?? 0,
      staff: mine.filter((s) => s.status === "active").reduce((a, s) => a + s.n, 0),
      invited: mine.filter((s) => s.status === "invited").reduce((a, s) => a + s.n, 0),
      tablets: tablets.get(o.id)?.n ?? 0,
      ownerStatus: owners.some((s) => s.status === "active") ? "active" : owners.some((s) => s.status === "invited") ? "invited" : "none",
      lastSignInAt: lasts.length ? new Date(Math.max(...lasts.map((d) => new Date(d).getTime()))) : null,
      billing: billingState(sub, now),
      method: (sub?.billingMethod as "paypal" | "invoice" | undefined) ?? null,
      owed: open.reduce((a, i) => a + i.amountCents, 0),
      late: open.some((i) => !!i.lateAt),
      contract: cs.some((c) => c.status === "signed") ? "signed" : cs.length ? "sent" : "none",
    };
  });
}

export interface Dashboard {
  clients: number;
  billed: number;
  monthlyCents: number;
  owedCents: number;
  lateCount: number;
  awaitingSignature: number;
  newLeads: number;
}

/** The numbers on the admin home page. "Monthly" is this cycle's price for the homes each billed client has now. */
export async function dashboard(db: DB, now = new Date()): Promise<Dashboard> {
  const today = dayIn(now);
  const [{ n: clients }] = await db.select({ n: count() }).from(organizations);
  const subs = await db.select().from(subscriptions).where(and(sql`${subscriptions.orgId} is not null`, isNull(subscriptions.cancelledOn), inArray(subscriptions.status, ["APPROVED", "ACTIVE", "SUSPENDED"])));
  const homes = byOrg(await db.select({ orgId: facilities.orgId, n: count() }).from(facilities).groupBy(facilities.orgId));
  let monthlyCents = 0;
  for (const s of subs) {
    const schedule = scheduleOf(s);
    if (!schedule || today < schedule.trialEndsOn) continue;
    monthlyCents += (homes.get(s.orgId!)?.n ?? 0) * cycleOn(schedule, today).perHomeCents;
  }
  const unpaid = await db.select().from(billingInvoices).where(isNull(billingInvoices.paidAt));
  const [{ n: awaitingSignature }] = await db.select({ n: count() }).from(contracts).where(eq(contracts.status, "sent"));
  const [{ n: newLeads }] = await db.select({ n: count() }).from(leads).where(eq(leads.status, "new"));
  return {
    clients,
    billed: subs.length,
    monthlyCents,
    owedCents: unpaid.reduce((a, i) => a + i.amountCents, 0),
    lateCount: unpaid.filter((i) => i.lateAt).length,
    awaitingSignature,
    newLeads,
  };
}

export interface ClientDetail {
  org: typeof organizations.$inferSelect;
  homes: Array<{ id: string; name: string; timeZone: string; beds: number }>;
  people: Array<{ id: string; name: string; email: string; role: string; status: string; lastSignInAt: Date | null }>;
  residents: number;
  tablets: number;
  sub: Subscription | null;
  billing: BillingState;
  invoices: BillingInvoice[];
  contracts: Contract[];
  log: Array<typeof adminAudit.$inferSelect>;
}

export async function clientDetail(db: DB, orgId: string, now = new Date()): Promise<ClientDetail | null> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const homes = await db.select({ id: facilities.id, name: facilities.name, timeZone: facilities.timeZone, beds: facilities.beds }).from(facilities).where(eq(facilities.orgId, orgId)).orderBy(facilities.name);
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, status: users.status, lastSignInAt: users.lastSignInAt })
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(users.role, users.name);
  const [{ n: residentCount }] = await db.select({ n: count() }).from(residents).where(eq(residents.orgId, orgId));
  const [{ n: tablets }] = await db.select({ n: count() }).from(devices).where(and(eq(devices.orgId, orgId), isNull(devices.revokedAt)));
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  const invoices = await db.select().from(billingInvoices).where(eq(billingInvoices.orgId, orgId)).orderBy(desc(billingInvoices.periodEnd)).limit(36);
  const cs = await db.select().from(contracts).where(eq(contracts.orgId, orgId)).orderBy(desc(contracts.sentAt));
  const log = await db.select().from(adminAudit).where(eq(adminAudit.orgId, orgId)).orderBy(desc(adminAudit.at)).limit(30);
  return { org, homes, people, residents: residentCount, tablets, sub: sub ?? null, billing: billingState(sub ?? null, now), invoices, contracts: cs, log };
}

/** Creates a client (organization, homes, owner invitation), optionally from a demo request. */
export async function createClient(db: DB, adminId: string, raw: unknown, appUrl: string, leadId?: string | null): Promise<{ ok: true; orgId: string } | { ok: false; error: string }> {
  try {
    const { orgId } = await provisionOrganization(db, raw as Parameters<typeof provisionOrganization>[1], appUrl);
    if (leadId) await db.update(leads).set({ status: "won", orgId, updatedAt: new Date() }).where(eq(leads.id, leadId));
    await adminLog(db, { adminId, orgId, action: "client_created", entity: "organization", entityId: orgId, details: { fromLead: leadId ?? null } });
    return { ok: true, orgId };
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues[0].message : (e as Error).message;
    return { ok: false, error: msg };
  }
}

/** A fresh invitation link for an owner who hasn't set a password yet (the old link stops working). */
export async function resendOwnerInvite(db: DB, adminId: string, orgId: string, userId: string, appUrl: string): Promise<{ ok: true; email: string } | { ok: false; error: string }> {
  const [u] = await db.select().from(users).where(and(eq(users.id, userId), eq(users.orgId, orgId)));
  if (!u || u.status !== "invited" || u.role !== "owner") return { ok: false, error: "Only an owner who hasn't accepted their invitation can get a new link here." };
  await db.update(accountTokens).set({ cancelledAt: new Date() }).where(and(eq(accountTokens.userId, u.id), isNull(accountTokens.usedAt), isNull(accountTokens.cancelledAt)));
  const token = randomToken();
  await db.insert(accountTokens).values({ orgId, userId: u.id, purpose: "invite", tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
  await sendMail(db, {
    orgId,
    to: u.email,
    subject: "Your CareHouse One account is ready",
    body: `Hi ${u.name},\n\nHere's a new link to set your CareHouse One password. It works once and expires in ${INVITE_DAYS} days.\n\n${appUrl}/invite/${token}\n\nThen add your staff from the Staff page and register each home's tablet in Settings.`,
  });
  await audit(db, { orgId, actorId: null, action: "invitation_resent", entity: "user", entityId: u.id, details: { by: "CareHouse One" } });
  await adminLog(db, { adminId, orgId, action: "owner_invite_resent", entity: "user", entityId: u.id, details: { email: u.email } });
  return { ok: true, email: u.email };
}

export const LEAD_STATUSES = ["new", "contacted", "won", "lost"] as const;

export async function listLeads(db: DB): Promise<Lead[]> {
  return db.select().from(leads).orderBy(desc(leads.createdAt)).limit(200);
}

export async function updateLead(db: DB, adminId: string, id: string, raw: { status: unknown; notes: unknown }): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = z.object({ status: z.enum(LEAD_STATUSES), notes: z.string().trim().max(2000) }).safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose a status." };
  const rows = await db.update(leads).set({ status: p.data.status, notes: p.data.notes || null, updatedAt: new Date() }).where(eq(leads.id, id)).returning();
  if (!rows.length) return { ok: false, error: "No such lead." };
  await adminLog(db, { adminId, action: "lead_updated", entity: "lead", entityId: id, details: { status: p.data.status } });
  return { ok: true };
}

export async function getLead(db: DB, id: string): Promise<Lead | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [l] = await db.select().from(leads).where(eq(leads.id, id));
  return l ?? null;
}

/** Every invoice across clients, newest first, with the client's name. */
export async function allInvoices(db: DB, filter: "open" | "late" | "all") {
  const rows = await db
    .select({ inv: billingInvoices, org: organizations.name, method: subscriptions.billingMethod })
    .from(billingInvoices)
    .innerJoin(organizations, eq(organizations.id, billingInvoices.orgId))
    .innerJoin(subscriptions, eq(subscriptions.id, billingInvoices.subscriptionId))
    .where(filter === "open" ? isNull(billingInvoices.paidAt) : filter === "late" ? and(isNull(billingInvoices.paidAt), sql`${billingInvoices.lateAt} is not null`) : undefined)
    .orderBy(desc(billingInvoices.dueOn))
    .limit(300);
  return rows;
}

export async function allContracts(db: DB) {
  return db
    .select({ c: contracts, org: organizations.name })
    .from(contracts)
    .innerJoin(organizations, eq(organizations.id, contracts.orgId))
    .orderBy(desc(contracts.sentAt))
    .limit(300);
}
