import type { DB } from "@/db/client";
import { eq } from "drizzle-orm";
import { administrations, facilities, medicationOrders, organizations, residents, userFacilities, users, type Role } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { newTotpSecret } from "@/lib/totp";
import { addDays, localDate, zonedToUtc } from "@/lib/time";
import { newWristbandCode } from "./residents";

/**
 * Local development and test data only. These are not real people. The shared demo password is
 * for local databases; never seed a production database with it.
 */
export const DEMO_PASSWORD = "harbor-demo-2026-local";
/** Shared two-step key for local demo accounts (add it to an authenticator app, or run npm run dev:code). */
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPCAREHOUSEDEMOKEY";

export interface Seeded {
  orgId: string;
  facilities: { cedarRidge: string; mapleHouse: string };
  users: Record<"owner" | "manager" | "nurse" | "caregiver", { id: string; email: string; totpSecret: string }>;
}

export async function seedDemo(db: DB, opts: { orgName?: string; emailDomain?: string; fixedTotp?: boolean } = {}): Promise<Seeded> {
  const domain = opts.emailDomain ?? "harborviewliving.test";
  const [org] = await db.insert(organizations).values({ name: opts.orgName ?? "Harborview Community Living" }).returning();
  const [cr] = await db.insert(facilities).values({ orgId: org.id, name: "Cedar Ridge", licenseType: "IDD", beds: 8 }).returning();
  const [mh] = await db.insert(facilities).values({ orgId: org.id, name: "Maple House", licenseType: "IDD", beds: 6 }).returning();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const people: Array<[keyof Seeded["users"], string, string, Role, string[]]> = [
    ["owner", "Joy Okafor", `joy.okafor@${domain}`, "owner", [cr.id, mh.id]],
    ["manager", "Daniel Ruiz", `daniel.ruiz@${domain}`, "manager", [cr.id]],
    ["nurse", "Priya Shah", `priya.shah@${domain}`, "nurse", [cr.id, mh.id]],
    ["caregiver", "Andre Thomas", `andre.thomas@${domain}`, "med_caregiver", [cr.id]],
  ];
  const out = {} as Seeded["users"];
  for (const [key, name, email, role, facs] of people) {
    const totpSecret = opts.fixedTotp ? DEMO_TOTP_SECRET : newTotpSecret();
    const [u] = await db
      .insert(users)
      .values({ orgId: org.id, name, email, role, status: "active", passwordHash, mfaSecretEnc: encrypt(totpSecret), mfaEnabled: true })
      .returning();
    await db.insert(userFacilities).values(facs.map((facilityId) => ({ orgId: org.id, userId: u.id, facilityId })));
    out[key] = { id: u.id, email, totpSecret };
  }
  return { orgId: org.id, facilities: { cedarRidge: cr.id, mapleHouse: mh.id }, users: out };
}

export interface SeededCare {
  residents: Record<"diego" | "lena" | "marcus" | "ben", { id: string; wristbandCode: string }>;
  orders: Record<"lisinopril" | "omeprazole" | "sertraline" | "amlodipine" | "acetaminophen" | "metformin", string>;
}

/**
 * Local demo only: about two weeks of past doses so the monthly record isn't empty. Mostly given,
 * with the occasional refusal. Never used in tests or against a real database.
 */
export async function seedDoseHistory(db: DB, s: Seeded, now: Date, days = 14): Promise<void> {
  const tz = "America/New_York";
  const today = localDate(now, tz);
  const orders = await db.select().from(medicationOrders).where(eq(medicationOrders.orgId, s.orgId));
  const givers = [s.users.caregiver.id, s.users.nurse.id];
  for (let back = days; back >= 1; back--) {
    const date = addDays(today, -back);
    for (const o of orders.filter((x) => x.type === "scheduled")) {
      for (const time of o.times) {
        const at = zonedToUtc(date, time, tz);
        const refused = (back * 7 + time.length + o.name.length) % 23 === 0;
        await db.insert(administrations).values({
          orgId: s.orgId,
          residentId: o.residentId,
          orderId: o.id,
          scheduledFor: at,
          outcome: refused ? "refused" : "given",
          reason: refused ? "Declined; offered again 30 minutes later" : null,
          bpSystolic: o.bpCheck ? 118 + (back % 9) : null,
          bpDiastolic: o.bpCheck ? 74 + (back % 6) : null,
          residentScanned: true,
          packageScanned: !!o.packageCode,
          recordedBy: givers[back % 2],
          recordedAt: new Date(at.getTime() + ((back % 4) * 4 + 2) * 60_000),
        });
      }
    }
  }
}

/** Fictional residents and medication orders for local development and tests. */
export async function seedCare(db: DB, s: Seeded): Promise<SeededCare> {
  const cr = s.facilities.cedarRidge;
  const mh = s.facilities.mapleHouse;
  const people: Array<[keyof SeededCare["residents"], string, string, string, string, string[], string]> = [
    ["diego", "Diego", "Reyes", "101", cr, ["Sulfa drugs (rash)"], "Regular, low sodium"],
    ["marcus", "Marcus", "Bell", "102", cr, [], "Diabetic"],
    ["lena", "Lena", "Kim", "106", cr, [], "Regular"],
    ["ben", "Ben", "Carver", "1", mh, ["Penicillin (hives)"], "Regular"],
  ];
  const residentsOut = {} as SeededCare["residents"];
  for (const [key, first, last, room, facilityId, allergies, diet] of people) {
    const [r] = await db
      .insert(residents)
      .values({ orgId: s.orgId, facilityId, firstName: first, lastName: last, room, wristbandCode: newWristbandCode(), allergies, diet, admittedOn: "2024-03-01" })
      .returning();
    residentsOut[key] = { id: r.id, wristbandCode: r.wristbandCode };
  }
  const base = { orgId: s.orgId, startDate: "2026-01-15", createdBy: s.users.nurse.id, prescriber: "Dr. Alvarez" };
  const o = async (residentId: string, v: Partial<typeof medicationOrders.$inferInsert> & Pick<typeof medicationOrders.$inferInsert, "name" | "strength" | "purpose" | "type">) => {
    const [row] = await db.insert(medicationOrders).values({ ...base, route: "By mouth", residentId, ...v }).returning();
    return row.id;
  };
  const R = residentsOut;
  const orders: SeededCare["orders"] = {
    lisinopril: await o(R.lena.id, { name: "Lisinopril", strength: "10 mg tablet", purpose: "Blood pressure", type: "scheduled", times: ["08:00"], bpCheck: true, packageCode: "LIS10-LK" }),
    omeprazole: await o(R.lena.id, { name: "Omeprazole", strength: "20 mg capsule", purpose: "Reflux", type: "scheduled", times: ["08:00"], instructions: "Before breakfast" }),
    sertraline: await o(R.lena.id, { name: "Sertraline", strength: "50 mg tablet", purpose: "Mood", type: "scheduled", times: ["08:00", "20:00"] }),
    amlodipine: await o(R.diego.id, { name: "Amlodipine", strength: "5 mg tablet", purpose: "Blood pressure", type: "scheduled", times: ["08:00"] }),
    metformin: await o(R.marcus.id, { name: "Metformin", strength: "500 mg tablet", purpose: "Blood sugar", type: "scheduled", times: ["08:00", "17:00"], instructions: "Give with food" }),
    acetaminophen: await o(R.diego.id, { name: "Acetaminophen", strength: "500 mg tablet", purpose: "Pain or fever", type: "prn", prnReasons: ["Headache", "Fever over 100.4 °F", "Other pain"], prnMinIntervalMinutes: 360, prnMaxPerDay: 4 }),
  };
  return { residents: residentsOut, orders };
}
