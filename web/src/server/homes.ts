import { and, asc, count, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/db/client";
import { deviceFacilities, devices, facilities, handoffNotes, incidents, residents, safetyChecks, shiftPunches, userFacilities, users } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { validZone } from "@/lib/time-zones";
import { audit } from "./audit";
import type { Result } from "./residents";

/** Adding, editing and removing homes changes what the organization pays, so it's for owners only. */
export const canManageHomes = (actor: Pick<Actor, "role">) => actor.role === "owner";

export const homeSchema = z.object({
  name: z.string().trim().min(2, "Name the home, for example Oak House.").max(120),
  timeZone: z.string().refine(validZone, "Choose the home's time zone."),
  beds: z.coerce.number().int("Licensed beds is a whole number.").min(0).max(500),
});

/** Every home with its counts, for the Homes section in Settings. */
export async function listHomes(tx: Tx) {
  const homes = await tx.select().from(facilities).orderBy(asc(facilities.name));
  const active = await tx
    .select({ facilityId: residents.facilityId, n: count() })
    .from(residents)
    .where(eq(residents.status, "active"))
    .groupBy(residents.facilityId);
  const ever = await tx.select({ facilityId: residents.facilityId, n: count() }).from(residents).groupBy(residents.facilityId);
  const shifts = await tx.select({ facilityId: shiftPunches.facilityId, n: count() }).from(shiftPunches).groupBy(shiftPunches.facilityId);
  const reports = await tx.select({ facilityId: incidents.facilityId, n: count() }).from(incidents).groupBy(incidents.facilityId);
  const handoffs = await tx.select({ facilityId: handoffNotes.facilityId, n: count() }).from(handoffNotes).groupBy(handoffNotes.facilityId);
  const checks = await tx.select({ facilityId: safetyChecks.facilityId, n: count() }).from(safetyChecks).groupBy(safetyChecks.facilityId);
  const n = (rows: Array<{ facilityId: string; n: number }>, id: string) => rows.find((r) => r.facilityId === id)?.n ?? 0;
  return homes.map((h) => ({ ...h, activeResidents: n(active, h.id), removable: homes.length > 1 && n(ever, h.id) === 0 && n(shifts, h.id) === 0 && n(reports, h.id) === 0 && n(handoffs, h.id) === 0 && n(checks, h.id) === 0 }));
}

/**
 * A new home. Every owner (and whoever adds it) is assigned to it straight away; staff and tablets
 * are added to it from the Staff page and Settings.
 */
export async function addHome(tx: Tx, actor: Actor, orgId: string, raw: unknown): Promise<Result<{ id: string }>> {
  if (!canManageHomes(actor)) return { ok: false, error: "Only owners can add homes." };
  const p = homeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [same] = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.name, p.data.name));
  if (same) return { ok: false, error: `You already have a home called ${p.data.name}.` };
  const [home] = await tx.insert(facilities).values({ orgId, name: p.data.name, timeZone: p.data.timeZone, beds: p.data.beds }).returning();
  const owners = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "owner"), inArray(users.status, ["active", "invited"])));
  const ids = [...new Set([actor.id, ...owners.map((o) => o.id)])];
  await tx.insert(userFacilities).values(ids.map((userId) => ({ orgId, userId, facilityId: home.id })));
  await audit(tx, { orgId, actorId: actor.id, action: "home_added", entity: "facility", entityId: home.id, details: { name: home.name, timeZone: home.timeZone, beds: home.beds } });
  return { ok: true, message: `${home.name} is added. Assign staff to it on the Staff page and register or share a tablet for it below.`, data: { id: home.id } };
}

export async function updateHome(tx: Tx, actor: Actor, facilityId: string, raw: unknown): Promise<Result> {
  if (!canManageHomes(actor)) return { ok: false, error: "Only owners can change homes." };
  const p = homeSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [h] = await tx.select().from(facilities).where(eq(facilities.id, facilityId));
  if (!h) return { ok: false, error: "That home doesn't exist." };
  const [same] = await tx.select({ id: facilities.id }).from(facilities).where(eq(facilities.name, p.data.name));
  if (same && same.id !== h.id) return { ok: false, error: `You already have a home called ${p.data.name}.` };
  await tx.update(facilities).set(p.data).where(eq(facilities.id, h.id));
  const changed = (["name", "timeZone", "beds"] as const).filter((k) => h[k] !== p.data[k]);
  await audit(tx, { orgId: h.orgId, actorId: actor.id, action: "home_updated", entity: "facility", entityId: h.id, details: { changed, before: { name: h.name, timeZone: h.timeZone, beds: h.beds } } });
  return { ok: true, message: `${p.data.name} is saved.` };
}

/**
 * Only a home added by mistake: nobody has ever lived there and no shift was ever worked there,
 * and it isn't the last home. Staff and tablets that only belong to it must be moved first.
 */
export async function removeHome(tx: Tx, actor: Actor, facilityId: string): Promise<Result> {
  if (!canManageHomes(actor)) return { ok: false, error: "Only owners can remove homes." };
  const homes = await listHomes(tx);
  const h = homes.find((x) => x.id === facilityId);
  if (!h) return { ok: false, error: "That home doesn't exist." };
  if (!h.removable) {
    return { ok: false, error: homes.length === 1 ? "This is your only home." : `${h.name} has residents or shift records, which must be kept, so it can't be removed.` };
  }
  const links = await tx.select().from(userFacilities);
  const onlyHereIds = links.filter((l) => l.facilityId === h.id && !links.some((o) => o.userId === l.userId && o.facilityId !== h.id)).map((l) => l.userId);
  const stranded = onlyHereIds.length
    ? await tx.select({ name: users.name }).from(users).where(and(inArray(users.id, onlyHereIds), inArray(users.status, ["active", "invited"])))
    : [];
  if (stranded.length) return { ok: false, error: `Assign ${stranded.map((u) => u.name).join(", ")} to another home first (Staff > Edit).` };
  const tabletLinks = await tx.select({ deviceId: deviceFacilities.deviceId, facilityId: deviceFacilities.facilityId, name: devices.name, revokedAt: devices.revokedAt }).from(deviceFacilities).innerJoin(devices, eq(devices.id, deviceFacilities.deviceId));
  const onlyHere = tabletLinks.filter((l) => l.facilityId === h.id && !l.revokedAt && !tabletLinks.some((o) => o.deviceId === l.deviceId && o.facilityId !== h.id));
  if (onlyHere.length) return { ok: false, error: `Move or remove the tablet ${onlyHere.map((t) => `"${t.name}"`).join(", ")} first.` };
  await tx.delete(userFacilities).where(eq(userFacilities.facilityId, h.id));
  await tx.delete(deviceFacilities).where(eq(deviceFacilities.facilityId, h.id));
  await tx.delete(facilities).where(eq(facilities.id, h.id));
  await audit(tx, { orgId: h.orgId, actorId: actor.id, action: "home_removed", entity: "facility", entityId: h.id, details: { name: h.name } });
  return { ok: true, message: `${h.name} is removed.` };
}
