import { and, asc, desc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { facilities, incidentFollowups, incidents, residents, users, type Incident } from "@/db/schema";
import { canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { isDate, zonedToUtc } from "@/lib/time";
import { audit, sendMail } from "./audit";
import type { Result } from "./residents";

export const INCIDENT_TYPES = {
  fall: "Fall",
  injury: "Injury",
  behavior: "Behavior incident",
  medication_error: "Medication error",
  elopement: "Missing person / elopement",
  allegation: "Allegation of abuse, neglect or exploitation",
  hospital: "Emergency room visit or hospitalization",
  property: "Property damage or loss",
  other: "Other",
} as const;
export type IncidentType = keyof typeof INCIDENT_TYPES;

export const SEVERITIES = { minor: "Minor", moderate: "Moderate", serious: "Serious" } as const;

/** Types most states require reporting to the licensing agency, often within 24 hours. */
export const USUALLY_REPORTABLE: IncidentType[] = ["allegation", "elopement", "hospital"];
export const needsStateReport = (i: Pick<Incident, "type" | "severity">) => USUALLY_REPORTABLE.includes(i.type as IncidentType) || i.severity === "serious";

export const FOLLOWUP_KINDS = {
  guardian_notified: "Guardian or family notified",
  physician_notified: "Physician or nurse notified",
  state_notified: "State licensing agency notified",
  police_notified: "Police notified",
  note: "Follow-up note",
  closed: "Closed",
  reopened: "Reopened",
} as const;
export type FollowupKind = keyof typeof FOLLOWUP_KINDS;

const text = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);

export const incidentSchema = z.object({
  facilityId: z.string().uuid("Choose the home."),
  residentId: z.string().uuid().optional().or(z.literal("")).transform((v) => v || null),
  type: z.enum(Object.keys(INCIDENT_TYPES) as [IncidentType, ...IncidentType[]], { message: "Choose what kind of incident it was." }),
  severity: z.enum(["minor", "moderate", "serious"], { message: "Choose how serious it was." }),
  date: z.string().refine(isDate, "Enter the date it happened."),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Enter the time it happened."),
  location: text(200),
  description: z.string().trim().min(10, "Describe what happened, in facts: what you saw and heard.").max(5000),
  actionTaken: z.string().trim().min(3, "Say what was done right away, for example first aid or calling 911.").max(3000),
  injury: z.preprocess((v) => v === "yes" || v === true, z.boolean()),
  injuryDetails: text(2000),
  witnesses: text(500),
});

/** Who sees which reports: owners and admins every report in their homes, everyone else the ones they filed. */
function visible(actor: Actor) {
  return canManageCare(actor) ? undefined : eq(incidents.reportedBy, actor.id);
}

/**
 * Anyone working at the home can file a report. It's permanent once filed, and owners and admins
 * get an email (without any names or details) to go and review it.
 */
export async function fileIncident(tx: Tx, actor: Actor, orgId: string, raw: unknown, appUrl: string, now: Date): Promise<Result<{ id: string }>> {
  const p = incidentSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const d = p.data;
  if (!canSeeFacility(actor, d.facilityId)) return { ok: false, error: "You're not assigned to that home." };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, d.facilityId));
  if (!home) return { ok: false, error: "Choose the home." };
  if (d.residentId) {
    const [r] = await tx.select({ facilityId: residents.facilityId }).from(residents).where(eq(residents.id, d.residentId));
    if (!r || r.facilityId !== home.id) return { ok: false, error: "That resident doesn't live at that home." };
  }
  if (d.injury && !d.injuryDetails) return { ok: false, error: "Describe the injury." };
  const occurredAt = zonedToUtc(d.date, d.time, home.timeZone);
  if (occurredAt.getTime() > now.getTime() + 5 * 60_000) return { ok: false, error: "The time it happened can't be in the future." };
  const [row] = await tx
    .insert(incidents)
    .values({
      orgId,
      facilityId: home.id,
      residentId: d.residentId,
      type: d.type,
      severity: d.severity,
      occurredAt,
      location: d.location,
      description: d.description,
      actionTaken: d.actionTaken,
      injury: d.injury,
      injuryDetails: d.injury ? d.injuryDetails : null,
      witnesses: d.witnesses,
      reportedBy: actor.id,
      reportedAt: now,
    })
    .returning();
  await audit(tx, { orgId, actorId: actor.id, action: "incident_filed", entity: "incident", entityId: row.id, details: { type: d.type, severity: d.severity, facilityId: home.id } });
  const reviewers = await tx.select({ email: users.email }).from(users).where(and(inArray(users.role, ["owner", "admin"]), eq(users.status, "active")));
  for (const r of reviewers) {
    await sendMail(tx, {
      orgId,
      to: r.email,
      subject: `New ${d.severity} incident report at ${home.name}`,
      body: `A ${d.severity} incident report (${INCIDENT_TYPES[d.type].toLowerCase()}) was just filed at ${home.name}. Sign in to review it and record who was notified:\n\n${appUrl}/incidents/${row.id}`,
    });
  }
  return { ok: true, message: "Report filed. The owner and admins have been told.", data: { id: row.id } };
}

export interface IncidentListRow {
  i: Incident;
  home: string;
  tz: string;
  resident: string | null;
  by: string | null;
  open: boolean;
}

/** Open first (newest first), then closed; optionally only one resident's, or one month's. */
export async function listIncidents(tx: Tx, actor: Actor, opts: { residentId?: string; from?: Date; to?: Date; status?: "open" | "closed" } = {}): Promise<IncidentListRow[]> {
  const rows = await tx
    .select({ i: incidents, home: facilities.name, tz: facilities.timeZone, first: residents.firstName, last: residents.lastName, by: users.name })
    .from(incidents)
    .innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .leftJoin(residents, eq(residents.id, incidents.residentId))
    .leftJoin(users, eq(users.id, incidents.reportedBy))
    .where(
      and(
        visible(actor),
        opts.residentId ? eq(incidents.residentId, opts.residentId) : undefined,
        opts.from ? gte(incidents.occurredAt, opts.from) : undefined,
        opts.to ? lt(incidents.occurredAt, opts.to) : undefined,
      ),
    )
    .orderBy(desc(incidents.occurredAt));
  const mine = rows.filter((r) => canSeeFacility(actor, r.i.facilityId));
  const states = await openStates(tx, mine.map((r) => r.i.id));
  const out = mine.map((r) => ({ i: r.i, home: r.home, tz: r.tz, resident: r.first ? `${r.first} ${r.last}` : null, by: r.by, open: states.get(r.i.id) ?? true }));
  const filtered = opts.status ? out.filter((r) => r.open === (opts.status === "open")) : out;
  return filtered.sort((a, b) => Number(b.open) - Number(a.open));
}

/** An incident is open until its latest close/reopen follow-up says closed. */
async function openStates(tx: Tx, ids: string[]): Promise<Map<string, boolean>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ incidentId: incidentFollowups.incidentId, kind: incidentFollowups.kind })
    .from(incidentFollowups)
    .where(and(inArray(incidentFollowups.incidentId, ids), or(eq(incidentFollowups.kind, "closed"), eq(incidentFollowups.kind, "reopened"))))
    .orderBy(asc(incidentFollowups.recordedAt));
  const m = new Map<string, boolean>();
  for (const r of rows) m.set(r.incidentId, r.kind !== "closed");
  return m;
}

export async function getIncident(tx: Tx, actor: Actor, id: string) {
  if (!z.string().uuid().safeParse(id).success) return null;
  const [row] = await tx
    .select({ i: incidents, home: facilities.name, tz: facilities.timeZone, first: residents.firstName, last: residents.lastName, by: users.name })
    .from(incidents)
    .innerJoin(facilities, eq(facilities.id, incidents.facilityId))
    .leftJoin(residents, eq(residents.id, incidents.residentId))
    .leftJoin(users, eq(users.id, incidents.reportedBy))
    .where(and(eq(incidents.id, id), visible(actor)));
  if (!row || !canSeeFacility(actor, row.i.facilityId)) return null;
  const followups = await tx
    .select({ f: incidentFollowups, by: users.name })
    .from(incidentFollowups)
    .leftJoin(users, eq(users.id, incidentFollowups.recordedBy))
    .where(eq(incidentFollowups.incidentId, id))
    .orderBy(asc(incidentFollowups.recordedAt));
  const open = (await openStates(tx, [id])).get(id) ?? true;
  const notified = (k: FollowupKind) => followups.find((f) => f.f.kind === k)?.f.recordedAt ?? null;
  return {
    ...row,
    resident: row.first ? `${row.first} ${row.last}` : null,
    followups,
    open,
    notified: { guardian: notified("guardian_notified"), physician: notified("physician_notified"), state: notified("state_notified") },
  };
}

const followupSchema = z.object({
  kind: z.enum(Object.keys(FOLLOWUP_KINDS) as [FollowupKind, ...FollowupKind[]], { message: "Choose what you're recording." }),
  details: text(3000),
});

/** Owners and admins record notifications and notes, and close or reopen the report. */
export async function addIncidentFollowup(tx: Tx, actor: Actor, incidentId: string, raw: unknown, now: Date): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins follow up on incident reports." };
  const inc = await getIncident(tx, actor, incidentId);
  if (!inc) return { ok: false, error: "That report doesn't exist." };
  const p = followupSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { kind, details } = p.data;
  if (kind === "closed" && !inc.open) return { ok: false, error: "It's already closed." };
  if (kind === "reopened" && inc.open) return { ok: false, error: "It's already open." };
  if ((kind === "note" || kind === "reopened") && !details) return { ok: false, error: "Add the details." };
  if (kind === "closed" && !details) return { ok: false, error: "Summarize the outcome before closing it." };
  await tx.insert(incidentFollowups).values({ orgId: inc.i.orgId, incidentId: inc.i.id, kind, details, recordedBy: actor.id, recordedAt: now });
  await audit(tx, { orgId: inc.i.orgId, actorId: actor.id, action: `incident_${kind}`, entity: "incident", entityId: inc.i.id });
  return { ok: true, message: kind === "closed" ? "The report is closed." : `${FOLLOWUP_KINDS[kind]}: recorded.` };
}

/** For the owner dashboard: open reports in the actor's homes. */
export async function openIncidentCount(tx: Tx, actor: Actor): Promise<number> {
  if (!canManageCare(actor)) return 0;
  return (await listIncidents(tx, actor, { status: "open" })).length;
}

export const residentsForIncident = (tx: Tx, facilityIds: string[]) =>
  tx
    .select({ id: residents.id, facilityId: residents.facilityId, firstName: residents.firstName, lastName: residents.lastName })
    .from(residents)
    .where(and(inArray(residents.facilityId, facilityIds.length ? facilityIds : ["00000000-0000-0000-0000-000000000000"]), eq(residents.status, "active"), isNull(residents.dischargedOn)))
    .orderBy(asc(residents.firstName));
