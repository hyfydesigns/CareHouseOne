import { and, asc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { deviceFacilities, devices, facilities, progressNotes, residents, shiftPunches, users, vitalReviews, vitals } from "@/db/schema";
import { canSeeFacility, type Actor } from "@/lib/permissions";
import { addDays, localDate, zonedToUtc } from "@/lib/time";
import { medicationPass } from "./meds";

export interface HomeSummary {
  id: string;
  name: string;
  timeZone: string;
  beds: number;
  residents: number;
  doses: { total: number; given: number; refused: number; held: number; due: number; late: number; upcoming: number };
  followupsOverdue: number;
  vitalsToday: number;
  readingsToReview: number;
  notesToday: number;
  onShift: Array<{ name: string; since: Date }>;
  tablets: Array<{ name: string; lastSeenAt: Date | null }>;
}

/** One card per home for the owner's view: today's work, in each home's own time zone. */
export async function homeSummaries(tx: Tx, actor: Actor, now: Date): Promise<HomeSummary[]> {
  const homes = (await tx.select().from(facilities).orderBy(asc(facilities.name))).filter((h) => canSeeFacility(actor, h.id));
  const out: HomeSummary[] = [];
  for (const h of homes) {
    const today = localDate(now, h.timeZone);
    const from = zonedToUtc(today, "00:00", h.timeZone);
    const to = zonedToUtc(addDays(today, 1), "00:00", h.timeZone);

    const pass = (await medicationPass(tx, actor, h.id, now)) ?? [];
    const doses = { total: 0, given: 0, refused: 0, held: 0, due: 0, late: 0, upcoming: 0 };
    let followupsOverdue = 0;
    for (const row of pass) {
      for (const s of row.slots) {
        doses.total++;
        doses[s.state]++;
      }
      followupsOverdue += row.openFollowups.filter((f) => f.dueAt < now).length;
    }

    const count = sql<number>`count(*)::int`;
    const [v] = await tx
      .select({ n: count })
      .from(vitals)
      .innerJoin(residents, eq(residents.id, vitals.residentId))
      .where(and(eq(residents.facilityId, h.id), gte(vitals.recordedAt, from), lt(vitals.recordedAt, to)));
    const [rev] = await tx
      .select({ n: count })
      .from(vitals)
      .innerJoin(residents, eq(residents.id, vitals.residentId))
      .leftJoin(vitalReviews, eq(vitalReviews.vitalId, vitals.id))
      .where(and(eq(residents.facilityId, h.id), isNull(vitalReviews.vitalId), sql`cardinality(${vitals.flags}) > 0`));
    const [n] = await tx
      .select({ n: count })
      .from(progressNotes)
      .innerJoin(residents, eq(residents.id, progressNotes.residentId))
      .where(and(eq(residents.facilityId, h.id), gte(progressNotes.recordedAt, from), lt(progressNotes.recordedAt, to)));
    const onShift = await tx
      .select({ name: users.name, since: shiftPunches.signedInAt })
      .from(shiftPunches)
      .innerJoin(users, eq(users.id, shiftPunches.userId))
      .where(and(eq(shiftPunches.facilityId, h.id), isNull(shiftPunches.signedOutAt)))
      .orderBy(asc(shiftPunches.signedInAt));
    const tablets = await tx
      .select({ name: devices.name, lastSeenAt: devices.lastSeenAt })
      .from(devices)
      .innerJoin(deviceFacilities, eq(deviceFacilities.deviceId, devices.id))
      .where(and(eq(deviceFacilities.facilityId, h.id), isNull(devices.revokedAt)))
      .orderBy(asc(devices.name));

    out.push({
      id: h.id,
      name: h.name,
      timeZone: h.timeZone,
      beds: h.beds,
      residents: pass.length,
      doses,
      followupsOverdue,
      vitalsToday: v?.n ?? 0,
      readingsToReview: rev?.n ?? 0,
      notesToday: n?.n ?? 0,
      onShift,
      tablets,
    });
  }
  return out;
}
