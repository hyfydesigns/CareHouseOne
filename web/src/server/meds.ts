import { and, asc, desc, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import {
  administrations,
  facilities,
  medicationOrders,
  prnFollowups,
  residents,
  users,
  type Administration,
  type MedicationOrder,
  type Resident,
} from "@/db/schema";
import { allergyConflict } from "@/lib/allergy";
import { canGiveMeds, canManageCare, canSeeFacility, type Actor } from "@/lib/permissions";
import { addDays, daysInMonth, isDate, isTime, localDate, localTime, zonedToUtc } from "@/lib/time";
import { audit } from "./audit";
import { getResident, residentName, type Result } from "./residents";

export const WINDOW_MINUTES = 60;
export const FOLLOWUP_MINUTES = 60;
export const BP_HOLD_BELOW = 100;
export const ROUTES = ["By mouth", "Under the tongue", "Topical", "Inhaled", "Eye drops", "Ear drops", "Nasal", "Injection", "Rectal", "G-tube", "Patch"] as const;

const MIN = 60_000;
const initials = (name: string) => name.split(/\s+/).map((p) => p[0]).join("").slice(0, 3).toUpperCase();

async function tzOf(tx: Tx, facilityId: string): Promise<string> {
  const [f] = await tx.select({ tz: facilities.timeZone }).from(facilities).where(eq(facilities.id, facilityId));
  return f?.tz ?? "America/New_York";
}

/** Is the order in effect on this local date? */
export function activeOn(o: Pick<MedicationOrder, "status" | "startDate" | "stopDate">, date: string): boolean {
  return o.status === "active" && o.startDate <= date && (!o.stopDate || date <= o.stopDate);
}

// ---------------------------------------------------------------- orders

const list = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((v) => (Array.isArray(v) ? v : (v ?? "").split(/[,\n]/)).map((x) => x.trim()).filter(Boolean));

export const orderSchema = z
  .object({
    name: z.string().trim().min(2, "Enter the medication name.").max(120),
    strength: z.string().trim().min(1, "Enter the strength and form, for example 10 mg tablet.").max(80),
    route: z.enum(ROUTES),
    purpose: z.string().trim().min(2, "Enter what the medication is for.").max(160),
    type: z.enum(["scheduled", "prn"]),
    times: list,
    bpCheck: z.coerce.boolean().default(false),
    prnReasons: list,
    prnMinIntervalHours: z.coerce.number().int().min(1).max(24).optional(),
    prnMaxPerDay: z.coerce.number().int().min(1).max(12).optional(),
    instructions: z.string().trim().max(300).optional(),
    prescriber: z.string().trim().max(120).optional(),
    packageCode: z.string().trim().max(64).optional(),
    startDate: z.string().trim().refine(isDate, "Enter the start date as YYYY-MM-DD."),
    stopDate: z.string().trim().optional().refine((s) => !s || isDate(s), "Enter the stop date as YYYY-MM-DD."),
  })
  .superRefine((v, ctx) => {
    if (v.type === "scheduled") {
      if (!v.times.length) ctx.addIssue({ code: "custom", message: "Pick at least one time, or choose As needed." });
      if (v.times.some((t) => !isTime(t))) ctx.addIssue({ code: "custom", message: "Times must look like 08:00." });
    } else {
      if (!v.prnReasons.length) ctx.addIssue({ code: "custom", message: "Enter at least one reason to give it." });
      if (!v.prnMinIntervalHours) ctx.addIssue({ code: "custom", message: "Enter the minimum hours between doses." });
      if (!v.prnMaxPerDay) ctx.addIssue({ code: "custom", message: "Enter the most doses allowed in a day." });
    }
    if (v.stopDate && v.stopDate < v.startDate) ctx.addIssue({ code: "custom", message: "The stop date is before the start date." });
  });

export async function createOrder(tx: Tx, actor: Actor, orgId: string, residentId: string, raw: unknown, now: Date): Promise<Result<{ id: string }>> {
  if (!canManageCare(actor)) return { ok: false, error: "Only nurses and managers can enter medication orders." };
  const resident = await getResident(tx, actor, residentId);
  if (!resident || resident.status !== "active") return { ok: false, error: "That resident isn't available." };
  const p = orderSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  const today = localDate(now, await tzOf(tx, resident.facilityId));
  if (v.stopDate && v.stopDate <= today) return { ok: false, error: "The stop date must be after today." };

  const conflict = allergyConflict(resident.allergies, v.name);
  if (conflict) {
    await audit(tx, { orgId, actorId: actor.id, action: "order_blocked_allergy", entity: "resident", entityId: resident.id, details: { medication: v.name, allergy: conflict } });
    return { ok: false, error: `${resident.firstName} is allergic to ${conflict}. Check with the prescriber before entering this order.` };
  }
  const active = await tx.select().from(medicationOrders).where(and(eq(medicationOrders.residentId, resident.id), eq(medicationOrders.status, "active")));
  if (active.some((o) => o.name.trim().toLowerCase() === v.name.toLowerCase() && (!o.stopDate || o.stopDate >= today))) {
    return { ok: false, error: `${v.name} is already on ${resident.firstName}'s list. Stop the current order first if this one replaces it.` };
  }
  const [o] = await tx
    .insert(medicationOrders)
    .values({
      orgId,
      residentId: resident.id,
      name: v.name.charAt(0).toUpperCase() + v.name.slice(1),
      strength: v.strength,
      route: v.route,
      purpose: v.purpose,
      type: v.type,
      times: v.type === "scheduled" ? [...new Set(v.times)].sort() : [],
      bpCheck: v.type === "scheduled" && v.bpCheck,
      prnReasons: v.type === "prn" ? v.prnReasons : [],
      prnMinIntervalMinutes: v.type === "prn" ? (v.prnMinIntervalHours ?? 0) * 60 : null,
      prnMaxPerDay: v.type === "prn" ? v.prnMaxPerDay : null,
      instructions: v.instructions || null,
      prescriber: v.prescriber || null,
      packageCode: v.packageCode ? v.packageCode.toUpperCase() : null,
      startDate: v.startDate,
      stopDate: v.stopDate || null,
      createdBy: actor.id,
    })
    .returning();
  await audit(tx, { orgId, actorId: actor.id, action: "order_started", entity: "medication_order", entityId: o.id, details: { residentId: resident.id, name: o.name, type: o.type, times: o.times, stopDate: o.stopDate } });
  return { ok: true, message: `${o.name} added for ${resident.firstName}.`, data: { id: o.id } };
}

export async function stopOrder(tx: Tx, actor: Actor, orderId: string, reason: string): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only nurses and managers can stop medication orders." };
  const [o] = await tx.select().from(medicationOrders).where(eq(medicationOrders.id, orderId));
  if (!o || o.status !== "active") return { ok: false, error: "That order is already stopped." };
  if (!(await getResident(tx, actor, o.residentId))) return { ok: false, error: "That resident isn't available." };
  const why = reason.trim() || "Stopped by prescriber";
  await tx.update(medicationOrders).set({ status: "stopped", stoppedBy: actor.id, stoppedAt: new Date(), stopReason: why }).where(eq(medicationOrders.id, o.id));
  await audit(tx, { orgId: o.orgId, actorId: actor.id, action: "order_stopped", entity: "medication_order", entityId: o.id, details: { reason: why } });
  return { ok: true, message: `${o.name} stopped. It's off the medication pass and stays in the record.` };
}

export async function listOrders(tx: Tx, residentId: string) {
  return tx
    .select({ order: medicationOrders, createdByName: users.name })
    .from(medicationOrders)
    .leftJoin(users, eq(users.id, medicationOrders.createdBy))
    .where(eq(medicationOrders.residentId, residentId))
    .orderBy(asc(medicationOrders.status), asc(medicationOrders.name));
}

// ---------------------------------------------------------------- medication pass

export type SlotState = "upcoming" | "due" | "late" | "given" | "refused" | "held";

export interface Slot {
  order: MedicationOrder;
  time: string;
  scheduledFor: Date;
  state: SlotState;
  dose: (Administration & { byName: string | null }) | null;
}

function slotState(now: Date, at: Date, dose: Administration | null): SlotState {
  if (dose) return dose.outcome;
  if (now.getTime() < at.getTime() - WINDOW_MINUTES * MIN) return "upcoming";
  if (now.getTime() <= at.getTime() + WINDOW_MINUTES * MIN) return "due";
  return "late";
}

async function dosesBetween(tx: Tx, residentIds: string[], from: Date, to: Date) {
  if (!residentIds.length) return [];
  return tx
    .select({ dose: administrations, byName: users.name })
    .from(administrations)
    .leftJoin(users, eq(users.id, administrations.recordedBy))
    .where(and(inArray(administrations.residentId, residentIds), gte(administrations.recordedAt, new Date(from.getTime() - 86_400_000)), lt(administrations.recordedAt, new Date(to.getTime() + 86_400_000))));
}

/** Today's scheduled doses for one resident, in the home's time zone. */
export async function residentSlots(tx: Tx, resident: Resident, now: Date): Promise<Slot[]> {
  const tz = await tzOf(tx, resident.facilityId);
  const date = localDate(now, tz);
  const orders = (await tx.select().from(medicationOrders).where(and(eq(medicationOrders.residentId, resident.id), eq(medicationOrders.type, "scheduled")))).filter((o) => activeOn(o, date));
  const from = zonedToUtc(date, "00:00", tz);
  const to = zonedToUtc(addDays(date, 1), "00:00", tz);
  const doses = (await dosesBetween(tx, [resident.id], from, to)).filter((d) => d.dose.scheduledFor && d.dose.scheduledFor >= from && d.dose.scheduledFor < to);
  const slots: Slot[] = [];
  for (const o of orders) {
    for (const time of o.times) {
      const at = zonedToUtc(date, time, tz);
      const hit = doses.find((d) => d.dose.orderId === o.id && d.dose.scheduledFor?.getTime() === at.getTime());
      const dose = hit ? { ...hit.dose, byName: hit.byName } : null;
      slots.push({ order: o, time, scheduledFor: at, state: slotState(now, at, dose), dose });
    }
  }
  return slots.sort((a, b) => a.scheduledFor.getTime() - b.scheduledFor.getTime() || a.order.name.localeCompare(b.order.name));
}

export interface PassRow {
  resident: Resident;
  slots: Slot[];
  prnOrders: MedicationOrder[];
  openFollowups: Array<typeof prnFollowups.$inferSelect & { medication: string }>;
}

/** The medication pass for one home: every active resident's doses for today. */
export async function medicationPass(tx: Tx, actor: Actor, facilityId: string, now: Date): Promise<PassRow[] | null> {
  if (!canSeeFacility(actor, facilityId)) return null;
  const tz = await tzOf(tx, facilityId);
  const date = localDate(now, tz);
  const rs = await tx.select().from(residents).where(and(eq(residents.facilityId, facilityId), eq(residents.status, "active"))).orderBy(asc(residents.room), asc(residents.lastName));
  const out: PassRow[] = [];
  for (const r of rs) {
    const prnOrders = (await tx.select().from(medicationOrders).where(and(eq(medicationOrders.residentId, r.id), eq(medicationOrders.type, "prn")))).filter((o) => activeOn(o, date));
    out.push({ resident: r, slots: await residentSlots(tx, r, now), prnOrders, openFollowups: await openFollowups(tx, r.id) });
  }
  return out;
}

export async function openFollowups(tx: Tx, residentId: string) {
  const rows = await tx
    .select({ f: prnFollowups, name: medicationOrders.name, strength: medicationOrders.strength })
    .from(prnFollowups)
    .innerJoin(administrations, eq(administrations.id, prnFollowups.administrationId))
    .innerJoin(medicationOrders, eq(medicationOrders.id, administrations.orderId))
    .where(and(eq(prnFollowups.residentId, residentId), isNull(prnFollowups.result)))
    .orderBy(asc(prnFollowups.dueAt));
  return rows.map((r) => ({ ...r.f, medication: `${r.name} ${r.strength}` }));
}

// ---------------------------------------------------------------- recording doses

export type StopCode = "wrong_resident" | "wrong_medication" | "allergy" | "duplicate" | "bp_hold" | "too_soon" | "max_reached";
export type DoseResult = { ok: true; message: string } | { ok: false; error: string; stop?: StopCode };

const checks = z.object({
  orderId: z.string().uuid(),
  residentCode: z.string().trim().min(1, "Scan the resident's wristband or room card."),
  packageCode: z.string().trim().optional(),
  packageConfirmed: z.coerce.boolean().default(false),
  note: z.string().trim().max(500).optional(),
});

const scheduledSchema = checks.extend({
  scheduledFor: z.string().datetime(),
  outcome: z.enum(["given", "refused", "held"]),
  reason: z.string().trim().max(200).optional(),
  bpSystolic: z.coerce.number().int().optional(),
  bpDiastolic: z.coerce.number().int().optional(),
});

const prnSchema = checks.extend({ reason: z.string().trim().min(1, "Choose why you're giving it.") });

async function loadForDose(tx: Tx, actor: Actor, orderId: string) {
  const [o] = await tx.select().from(medicationOrders).where(eq(medicationOrders.id, orderId));
  if (!o) return null;
  const r = await getResident(tx, actor, o.residentId);
  if (!r || r.status !== "active") return null;
  return { order: o, resident: r, tz: await tzOf(tx, r.facilityId) };
}

/** The safety checks every dose passes before it can be recorded as given. */
async function safetyStops(
  tx: Tx,
  actor: Actor,
  ctx: { order: MedicationOrder; resident: Resident },
  input: { residentCode: string; packageCode?: string; packageConfirmed: boolean },
  giving: boolean,
): Promise<DoseResult | null> {
  const stop = async (code: StopCode, error: string): Promise<DoseResult> => {
    await audit(tx, { orgId: ctx.resident.orgId, actorId: actor.id, action: "medication_stop", entity: "resident", entityId: ctx.resident.id, details: { code, orderId: ctx.order.id } });
    return { ok: false, error, stop: code };
  };
  if (input.residentCode.trim().toUpperCase() !== ctx.resident.wristbandCode) {
    return stop("wrong_resident", `Stop. That code isn't ${residentName(ctx.resident)}'s. Check you're with the right person and scan their wristband again.`);
  }
  if (!giving) return null;
  if (ctx.order.packageCode) {
    if ((input.packageCode ?? "").trim().toUpperCase() !== ctx.order.packageCode) {
      return stop("wrong_medication", `Stop. That package doesn't match ${ctx.order.name} ${ctx.order.strength}. Check the label against the order.`);
    }
  } else if (!input.packageConfirmed) {
    return { ok: false, error: `Check the package label matches ${ctx.order.name} ${ctx.order.strength}, then confirm.` };
  }
  const allergy = allergyConflict(ctx.resident.allergies, ctx.order.name);
  if (allergy) return stop("allergy", `Stop. ${ctx.resident.firstName} is allergic to ${allergy}. Don't give this medication; call the nurse.`);
  return null;
}

export async function recordScheduledDose(tx: Tx, actor: Actor, raw: unknown, now: Date): Promise<DoseResult> {
  if (!canGiveMeds(actor)) return { ok: false, error: "Only nurses and med-certified caregivers can give medications." };
  const p = scheduledSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  const ctx = await loadForDose(tx, actor, v.orderId);
  if (!ctx || ctx.order.type !== "scheduled") return { ok: false, error: "That medication order isn't available." };
  const at = new Date(v.scheduledFor);
  const date = localDate(at, ctx.tz);
  if (!activeOn(ctx.order, date) || !ctx.order.times.includes(localTime(at, ctx.tz))) return { ok: false, error: "That dose isn't on the current order." };
  if (now.getTime() < at.getTime() - WINDOW_MINUTES * MIN) return { ok: false, error: `This dose isn't due until ${localTime(at, ctx.tz)}. Doses can be given up to ${WINDOW_MINUTES} minutes early.` };

  const [existing] = await tx.select({ d: administrations, by: users.name }).from(administrations).leftJoin(users, eq(users.id, administrations.recordedBy)).where(and(eq(administrations.orderId, ctx.order.id), eq(administrations.scheduledFor, at)));
  if (existing) {
    return { ok: false, stop: "duplicate", error: `Stop. This dose was already recorded at ${localTime(existing.d.recordedAt, ctx.tz)} by ${existing.by ?? "someone else"}.` };
  }
  const giving = v.outcome === "given";
  const blocked = await safetyStops(tx, actor, ctx, v, giving);
  if (blocked) return blocked;

  if (ctx.order.bpCheck && v.outcome !== "refused") {
    if (v.bpSystolic == null || v.bpDiastolic == null) return { ok: false, error: "Take and enter blood pressure first. This order needs it before every dose." };
    if (v.bpSystolic < 60 || v.bpSystolic > 260 || v.bpDiastolic < 30 || v.bpDiastolic > 160) return { ok: false, error: "That blood pressure doesn't look possible. Check it and enter it again." };
    if (giving && v.bpSystolic < BP_HOLD_BELOW) {
      return { ok: false, stop: "bp_hold", error: `Hold this dose: the top number is under ${BP_HOLD_BELOW}. Record it as held and tell the nurse.` };
    }
  }
  if (!giving && !v.reason) return { ok: false, error: v.outcome === "refused" ? "Say what happened when they refused." : "Say why the dose was held." };

  const late = now.getTime() > at.getTime() + WINDOW_MINUTES * MIN;
  await tx.insert(administrations).values({
    orgId: ctx.resident.orgId,
    residentId: ctx.resident.id,
    orderId: ctx.order.id,
    scheduledFor: at,
    outcome: v.outcome,
    reason: v.reason || null,
    note: v.note || null,
    bpSystolic: v.bpSystolic ?? null,
    bpDiastolic: v.bpDiastolic ?? null,
    late,
    residentScanned: true,
    packageScanned: !!ctx.order.packageCode,
    recordedBy: actor.id,
    recordedAt: now,
  });
  await audit(tx, { orgId: ctx.resident.orgId, actorId: actor.id, action: "dose_recorded", entity: "medication_order", entityId: ctx.order.id, details: { outcome: v.outcome, scheduledFor: v.scheduledFor, late } });
  const what = v.outcome === "given" ? "given" : v.outcome === "refused" ? "recorded as refused" : "recorded as held";
  return { ok: true, message: `${ctx.order.name} ${what} for ${ctx.resident.firstName}${late ? ". Marked late: given more than 60 minutes after its time" : ""}.` };
}

export async function recordPrnDose(tx: Tx, actor: Actor, raw: unknown, now: Date): Promise<DoseResult> {
  if (!canGiveMeds(actor)) return { ok: false, error: "Only nurses and med-certified caregivers can give medications." };
  const p = prnSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const v = p.data;
  const ctx = await loadForDose(tx, actor, v.orderId);
  if (!ctx || ctx.order.type !== "prn" || !activeOn(ctx.order, localDate(now, ctx.tz))) return { ok: false, error: "That medication order isn't available." };
  if (!ctx.order.prnReasons.includes(v.reason)) return { ok: false, error: "Choose one of the reasons on the order." };
  const blocked = await safetyStops(tx, actor, ctx, v, true);
  if (blocked) return blocked;

  const given = await tx
    .select()
    .from(administrations)
    .where(and(eq(administrations.orderId, ctx.order.id), eq(administrations.outcome, "given"), isNull(administrations.scheduledFor)))
    .orderBy(desc(administrations.recordedAt));
  const last = given[0];
  const gap = ctx.order.prnMinIntervalMinutes ?? 0;
  if (last && now.getTime() - last.recordedAt.getTime() < gap * MIN) {
    const next = new Date(last.recordedAt.getTime() + gap * MIN);
    return { ok: false, stop: "too_soon", error: `Too soon. The last dose was at ${localTime(last.recordedAt, ctx.tz)}; the next is allowed at ${localTime(next, ctx.tz)}.` };
  }
  const today = localDate(now, ctx.tz);
  const todayCount = given.filter((d) => localDate(d.recordedAt, ctx.tz) === today).length;
  if (ctx.order.prnMaxPerDay && todayCount >= ctx.order.prnMaxPerDay) {
    return { ok: false, stop: "max_reached", error: `Stop. ${ctx.order.prnMaxPerDay} doses have already been given today, the most allowed. Call the nurse.` };
  }
  const [dose] = await tx
    .insert(administrations)
    .values({
      orgId: ctx.resident.orgId,
      residentId: ctx.resident.id,
      orderId: ctx.order.id,
      scheduledFor: null,
      outcome: "given",
      reason: v.reason,
      note: v.note || null,
      residentScanned: true,
      packageScanned: !!ctx.order.packageCode,
      recordedBy: actor.id,
      recordedAt: now,
    })
    .returning();
  const dueAt = new Date(now.getTime() + FOLLOWUP_MINUTES * MIN);
  await tx.insert(prnFollowups).values({ orgId: ctx.resident.orgId, administrationId: dose.id, residentId: ctx.resident.id, dueAt });
  await audit(tx, { orgId: ctx.resident.orgId, actorId: actor.id, action: "prn_given", entity: "medication_order", entityId: ctx.order.id, details: { reason: v.reason } });
  return { ok: true, message: `${ctx.order.name} given for ${ctx.resident.firstName}. Check how it worked at ${localTime(dueAt, ctx.tz)}.` };
}

const followupSchema = z.object({
  followupId: z.string().uuid(),
  result: z.enum(["effective", "partly_effective", "not_effective"]),
  note: z.string().trim().max(500).optional(),
});

export async function recordFollowup(tx: Tx, actor: Actor, raw: unknown, now: Date): Promise<Result> {
  if (!canGiveMeds(actor) && !canManageCare(actor)) return { ok: false, error: "Your role can't record follow-ups." };
  const p = followupSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: "Choose how well it worked." };
  const [f] = await tx.select().from(prnFollowups).where(eq(prnFollowups.id, p.data.followupId));
  if (!f || f.result) return { ok: false, error: "That follow-up was already recorded." };
  if (!(await getResident(tx, actor, f.residentId))) return { ok: false, error: "That resident isn't available." };
  await tx.update(prnFollowups).set({ result: p.data.result, note: p.data.note || null, recordedBy: actor.id, recordedAt: now }).where(eq(prnFollowups.id, f.id));
  await audit(tx, { orgId: f.orgId, actorId: actor.id, action: "prn_followup_recorded", entity: "prn_followup", entityId: f.id, details: { result: p.data.result } });
  return { ok: true, message: "Follow-up recorded." };
}

/** Overdue follow-ups in the actor's homes, for notifications. */
export async function overdueFollowups(tx: Tx, actor: Actor, now: Date) {
  const rows = await tx
    .select({ f: prnFollowups, r: residents, name: medicationOrders.name })
    .from(prnFollowups)
    .innerJoin(residents, eq(residents.id, prnFollowups.residentId))
    .innerJoin(administrations, eq(administrations.id, prnFollowups.administrationId))
    .innerJoin(medicationOrders, eq(medicationOrders.id, administrations.orderId))
    .where(and(isNull(prnFollowups.result), lt(prnFollowups.dueAt, now)));
  return rows.filter((x) => canSeeFacility(actor, x.r.facilityId));
}

// ---------------------------------------------------------------- monthly record

export interface MonthCell {
  outcome: "given" | "refused" | "held" | "due" | "missed";
  by?: string;
  late?: boolean;
}

/** The month's medication record: one row per scheduled order and time, one cell per day. */
export async function monthRecord(tx: Tx, resident: Resident, year: number, month: number, now: Date) {
  const tz = await tzOf(tx, resident.facilityId);
  const today = localDate(now, tz);
  const n = daysInMonth(year, month);
  const first = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}`;
  const orders = await tx.select().from(medicationOrders).where(eq(medicationOrders.residentId, resident.id));
  const from = zonedToUtc(first, "00:00", tz);
  const to = zonedToUtc(addDays(last, 1), "00:00", tz);
  const doses = await tx
    .select({ d: administrations, by: users.name })
    .from(administrations)
    .leftJoin(users, eq(users.id, administrations.recordedBy))
    .where(and(eq(administrations.residentId, resident.id), gte(administrations.recordedAt, new Date(from.getTime() - 86_400_000)), lt(administrations.recordedAt, new Date(to.getTime() + 86_400_000))));

  const rows = orders
    .filter((o) => o.type === "scheduled" && o.startDate <= last && (!o.stopDate || o.stopDate >= first))
    .flatMap((o) =>
      o.times.map((time) => {
        const cells: Array<MonthCell | null> = [];
        for (let d = 1; d <= n; d++) {
          const date = `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const inEffect = o.startDate <= date && (!o.stopDate || date <= o.stopDate) && (o.status === "active" || (o.stoppedAt && date <= localDate(o.stoppedAt, tz)));
          if (!inEffect || date > today) {
            cells.push(null);
            continue;
          }
          const at = zonedToUtc(date, time, tz);
          const hit = doses.find((x) => x.d.orderId === o.id && x.d.scheduledFor?.getTime() === at.getTime());
          if (hit) cells.push({ outcome: hit.d.outcome, by: hit.by ? initials(hit.by) : undefined, late: hit.d.late });
          else if (now.getTime() > at.getTime() + WINDOW_MINUTES * MIN) cells.push({ outcome: "missed" });
          else cells.push({ outcome: "due" });
        }
        return { order: o, time, cells };
      }),
    );
  const prn = doses
    .filter((x) => !x.d.scheduledFor && x.d.recordedAt >= from && x.d.recordedAt < to)
    .map((x) => ({ dose: x.d, order: orders.find((o) => o.id === x.d.orderId)!, by: x.by }))
    .sort((a, b) => b.dose.recordedAt.getTime() - a.dose.recordedAt.getTime());
  return { days: n, rows, prn, tz };
}

