import { and, eq, sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import {
  adlEntries,
  administrations,
  appointments,
  deviceFacilities,
  devices,
  facilities,
  handoffNotes,
  incidentFollowups,
  incidents,
  medicationCatalog,
  noteAttachments,
  medicationOrders,
  organizations,
  progressNotes,
  safetyChecks,
  shiftPunches,
  staffCertifications,
  users,
  vitals,
} from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { addDays, localDate, zonedToUtc } from "@/lib/time";
import { SAMPLE_CATALOG } from "./med-sample";
import { seedCare, seedDemo, seedDoseHistory, type Seeded, type SeededCare } from "./seed";

/**
 * The public demo (demo.carehouseone.com): the same app on its own database, filled with made-up
 * residents, with one-click sign-in and a banner saying so. Never set DEMO_MODE on the real app.
 */
export const demoMode = () => process.env.DEMO_MODE === "true";

const TZ = "America/New_York";

/**
 * Refuses unless this is the demo app on its own database: the in-memory one (no DATABASE_URL),
 * or a PostgreSQL database whose name says demo.
 */
async function assertDemoDatabase(db: DB): Promise<void> {
  if (!demoMode()) throw new Error("Not the demo app.");
  if (!process.env.DATABASE_URL) return;
  const rows = (await db.execute(sql`select current_database() as name`)) as unknown as { rows?: Array<{ name: string }> } | Array<{ name: string }>;
  const name = (Array.isArray(rows) ? rows[0] : rows.rows?.[0])?.name ?? "";
  if (!/demo/i.test(name)) throw new Error(`Refusing to reset "${name}": the demo database's name must contain "demo".`);
}

/** Empty on first start: fill it. */
export async function seedDemoIfEmpty(db: DB, now = new Date()): Promise<boolean> {
  await assertDemoDatabase(db);
  const [any] = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (any) return false;
  await fillDemo(db, now);
  return true;
}

/** How long demo data lasts before the next visitor gets a fresh copy. */
export const DEMO_REFRESH_HOURS = 12;

/** True when the demo data is older than DEMO_REFRESH_HOURS (or missing). */
export async function demoIsStale(db: DB, now = new Date()): Promise<boolean> {
  const [org] = await db.select({ createdAt: organizations.createdAt }).from(organizations).limit(1);
  return !org || now.getTime() - org.createdAt.getTime() > DEMO_REFRESH_HOURS * 3_600_000;
}

/**
 * Wipe everything visitors changed and start again with fresh data, dated around today.
 * Reference data (ICD-10-CM, the medication list) is kept.
 */
export async function resetDemo(db: DB, now = new Date(), opts: { skipDatabaseCheck?: boolean } = {}): Promise<void> {
  if (!opts.skipDatabaseCheck) await assertDemoDatabase(db);
  await db.execute(sql`truncate organizations, outbox, rate_limits, leads, billing_events restart identity cascade`);
  await fillDemo(db, now);
}

async function fillDemo(db: DB, now: Date): Promise<void> {
  // The medication list is kept between resets; load the starter list only if there's none.
  const [med] = await db.select({ id: medicationCatalog.id }).from(medicationCatalog).limit(1);
  if (!med) await db.insert(medicationCatalog).values(SAMPLE_CATALOG.map((r) => ({ ...r, version: "starter list" }))).onConflictDoNothing();
  const s = await seedDemo(db, { fixedTotp: true });
  const care = await seedCare(db, s);
  await seedDoseHistory(db, s, now, 21);
  await seedToday(db, s, now);
  await seedShowcase(db, s, care, now);
}

/** Today's doses up to an hour ago are given, so the pass shows a normal day with one dose late. */
async function seedToday(db: DB, s: Seeded, now: Date): Promise<void> {
  const today = localDate(now, TZ);
  const orders = await db.select().from(medicationOrders).where(and(eq(medicationOrders.orgId, s.orgId), eq(medicationOrders.type, "scheduled")));
  let leftLate = false;
  for (const o of orders) {
    for (const time of o.times) {
      const at = zonedToUtc(today, time, TZ);
      if (at.getTime() > now.getTime() - 90 * 60_000) continue;
      if (!leftLate && o.name === "Amlodipine") {
        leftLate = true; // one late dose for the dashboard to flag
        continue;
      }
      await db.insert(administrations).values({
        orgId: s.orgId,
        residentId: o.residentId,
        orderId: o.id,
        scheduledFor: at,
        outcome: "given",
        bpSystolic: o.bpCheck ? 122 : null,
        bpDiastolic: o.bpCheck ? 78 : null,
        residentScanned: true,
        packageScanned: !!o.packageCode,
        recordedBy: s.users.caregiver.id,
        recordedAt: new Date(at.getTime() + 6 * 60_000),
      });
    }
  }
}

/** A week of vitals and notes, incidents, appointments, drills, training and a handoff note. */
async function seedShowcase(db: DB, s: Seeded, c: SeededCare, now: Date): Promise<void> {
  const { orgId } = s;
  const cr = s.facilities.cedarRidge;
  const mh = s.facilities.mapleHouse;
  const andre = s.users.caregiver.id;
  const joy = s.users.owner.id;
  const today = localDate(now, TZ);
  const at = (daysBack: number, time: string) => zonedToUtc(addDays(today, -daysBack), time, TZ);
  const R = c.residents;

  for (let d = 6; d >= 1; d--) {
    for (const [rid, sys, dia, pulse] of [[R.lena.id, 126, 80, 72], [R.diego.id, 132, 84, 76], [R.marcus.id, 118, 76, 80], [R.ben.id, 120, 78, 68]] as const) {
      await db.insert(vitals).values({ orgId, residentId: rid, systolic: sys + (d % 3) * 2, diastolic: dia + (d % 2), pulse: pulse + d, tempTenthsF: 980 + (d % 4), bpPosition: "sitting", recordedBy: andre, recordedAt: at(d, "09:15") });
    }
  }
  await db.insert(vitals).values({ orgId, residentId: R.marcus.id, systolic: 124, diastolic: 80, pulse: 84, bloodSugar: 268, bpPosition: "sitting", flags: ["blood sugar"], recordedBy: andre, recordedAt: at(0, "07:40") });

  // Three weeks of daily care (ADLs), day and evening shifts, with each resident's usual needs.
  type Plan = Record<"bathing" | "dressing" | "grooming" | "toileting" | "continence" | "eating" | "mobility", string>;
  const plans: Array<[string, Plan]> = [
    [R.lena.id, { bathing: "supervision", dressing: "independent", grooming: "independent", toileting: "independent", continence: "independent", eating: "independent", mobility: "independent" }],
    [R.diego.id, { bathing: "limited", dressing: "supervision", grooming: "supervision", toileting: "independent", continence: "independent", eating: "independent", mobility: "limited" }],
    [R.marcus.id, { bathing: "supervision", dressing: "supervision", grooming: "limited", toileting: "independent", continence: "independent", eating: "supervision", mobility: "independent" }],
    [R.ben.id, { bathing: "extensive", dressing: "limited", grooming: "limited", toileting: "supervision", continence: "supervision", eating: "supervision", mobility: "supervision" }],
  ];
  const adlRows: Array<typeof adlEntries.$inferInsert> = [];
  for (let d = 21; d >= 1; d--) {
    for (const [rid, plan] of plans) {
      for (const [shift, time] of [["day", "09:30"], ["evening", "20:30"]] as const) {
        for (const [activity, usual] of Object.entries(plan)) {
          // Showers on the day shift every other day; otherwise bathing isn't needed.
          let support = activity === "bathing" ? (shift === "day" && d % 2 === 0 ? usual : "not_needed") : usual;
          let note: string | null = null;
          if (rid === R.marcus.id && activity === "bathing" && d === 6 && shift === "day") {
            support = "refused";
            note = "Marcus refused his shower. Offered again after lunch and he agreed to wash up at the sink.";
          }
          if (rid === R.diego.id && activity === "mobility" && d <= 2) support = "extensive"; // sore knee this week
          adlRows.push({ orgId, residentId: rid, shift, activity, support, note, recordedBy: andre, recordedAt: at(d, time) });
        }
      }
    }
  }
  for (const [activity, support] of Object.entries(plans[0][1])) {
    if (["grooming", "dressing", "eating", "toileting"].includes(activity)) adlRows.push({ orgId, residentId: R.lena.id, shift: "day", activity, support, recordedBy: andre, recordedAt: at(0, "08:30") });
  }
  for (let i = 0; i < adlRows.length; i += 500) await db.insert(adlEntries).values(adlRows.slice(i, i + 500));

  const notes: Array<[string, number, "day" | "evening", "general" | "activity" | "health" | "behavior" | "family_contact", string]> = [
    [R.lena.id, 2, "day", "activity", "Lena joined the morning walk to the park and talked with neighbors. Good mood all day."],
    [R.diego.id, 1, "evening", "health", "Diego said his knee hurt after dinner. Offered acetaminophen; he said he would rest instead. No swelling seen."],
    [R.marcus.id, 1, "day", "behavior", "Marcus was upset when the TV remote went missing. Calmed down after we found it together and he chose a show."],
    [R.ben.id, 0, "day", "family_contact", "Ben's sister called to plan a visit on Saturday at 2 PM."],
  ];
  for (const [rid, d, shift, category, body] of notes) {
    await db.insert(progressNotes).values({ orgId, residentId: rid, shift, category, body, recordedBy: andre, recordedAt: at(d, shift === "day" ? "13:20" : "19:45") });
  }

  // A note with a scanned document attached, as a caregiver would take it with the tablet's camera.
  const [visit] = await db
    .insert(progressNotes)
    .values({ orgId, residentId: R.marcus.id, shift: "day", category: "health", body: "Back from Dr. Chen (neurology). No seizures in 6 months, same plan. Visit summary scanned and attached; blood test in 2 weeks.", recordedBy: andre, recordedAt: at(8, "11:40") })
    .returning({ id: progressNotes.id });
  const scan = visitSummaryPdf(addDays(today, -8));
  await db.insert(noteAttachments).values({ orgId, noteId: visit.id, residentId: R.marcus.id, filename: "Visit summary.pdf", contentType: "application/pdf", sizeBytes: scan.length, data: scan, uploadedBy: andre, uploadedAt: at(8, "11:41") });

  const [fall] = await db
    .insert(incidents)
    .values({ orgId, facilityId: cr, residentId: R.lena.id, type: "fall", severity: "moderate", occurredAt: at(1, "06:50"), location: "Bathroom", description: "Found Lena sitting on the bathroom floor next to the sink. She said she slipped while reaching for a towel.", actionTaken: "Checked her for injuries, helped her up with a second staff member, and stayed with her while she dressed.", injury: true, injuryDetails: "Small bruise on her left elbow, no swelling. She said the pain was 2 out of 10.", witnesses: "None", reportedBy: andre, reportedAt: at(1, "07:05") })
    .returning();
  await db.insert(incidentFollowups).values({ orgId, incidentId: fall.id, kind: "guardian_notified", details: "Called her brother Sam at 9:10 AM and explained what happened.", recordedBy: joy, recordedAt: at(1, "09:12") });
  const [refusal] = await db
    .insert(incidents)
    .values({ orgId, facilityId: cr, residentId: R.marcus.id, type: "medication_error", severity: "minor", occurredAt: at(5, "17:20"), description: "Marcus's 5 PM metformin was given 20 minutes late because dinner ran late.", actionTaken: "Gave it with dinner. Checked blood sugar at bedtime: 142.", injury: false, reportedBy: andre, reportedAt: at(5, "17:40") })
    .returning();
  await db.insert(incidentFollowups).values([
    { orgId, incidentId: refusal.id, kind: "physician_notified", details: "Nurse line said no action needed.", recordedBy: joy, recordedAt: at(5, "18:10") },
    { orgId, incidentId: refusal.id, kind: "closed", details: "Moved dinner prep 15 minutes earlier on weekdays.", recordedBy: joy, recordedAt: at(4, "10:00") },
  ]);

  await db.insert(appointments).values([
    { orgId, residentId: R.lena.id, facilityId: cr, scheduledAt: zonedToUtc(addDays(today, 1), "10:30", TZ), provider: "Dr. Patel, family doctor", purpose: "Blood pressure follow-up", location: "Riverside Clinic", notes: "Bring her medication list. Staff to drive.", createdBy: joy },
    { orgId, residentId: R.ben.id, facilityId: mh, scheduledAt: zonedToUtc(addDays(today, 3), "14:00", TZ), provider: "Bright Smiles Dental", purpose: "Cleaning", createdBy: joy },
    { orgId, residentId: R.marcus.id, facilityId: cr, scheduledAt: at(8, "09:00"), provider: "Dr. Chen, neurologist", purpose: "Seizure medication review", status: "done", outcome: "No seizures in 6 months. Keep the same plan.", followUp: "Blood test in 2 weeks.", createdBy: joy, updatedBy: andre, updatedAt: at(8, "11:30") },
  ]);

  await db.insert(safetyChecks).values([
    { orgId, facilityId: cr, kind: "fire_drill", performedAt: at(12, "10:00"), shift: "day", participants: 3, durationMinutes: 3, recordedBy: andre },
    { orgId, facilityId: cr, kind: "fire_drill", performedAt: at(45, "19:30"), shift: "evening", participants: 3, durationMinutes: 4, issues: "Marcus needed reminding to leave his tablet behind.", recordedBy: andre },
    { orgId, facilityId: cr, kind: "smoke_detectors", performedAt: at(10, "11:00"), shift: "day", recordedBy: andre },
    { orgId, facilityId: mh, kind: "fire_drill", performedAt: at(40, "10:00"), shift: "day", participants: 1, durationMinutes: 2, recordedBy: joy },
  ]);

  await db.insert(staffCertifications).values([
    { orgId, userId: andre, kind: "med_cert", issuedOn: addDays(today, -300), expiresOn: addDays(today, 430), recordedBy: joy },
    { orgId, userId: andre, kind: "cpr", issuedOn: addDays(today, -700), expiresOn: addDays(today, 20), notes: "American Red Cross", recordedBy: joy },
    { orgId, userId: andre, kind: "first_aid", issuedOn: addDays(today, -700), expiresOn: addDays(today, 20), recordedBy: joy },
    { orgId, userId: joy, kind: "cpr", issuedOn: addDays(today, -200), expiresOn: addDays(today, 530), recordedBy: joy },
  ]);

  // Andre is on shift at Cedar Ridge this morning.
  await db.insert(shiftPunches).values({ orgId, userId: andre, facilityId: cr, signedInAt: at(0, "06:55") });

  await db.insert(handoffNotes).values({ orgId, facilityId: cr, shift: "night", body: "Quiet night. Diego was up at 3 AM for water, back to sleep by 3:30. The van needs gas before Lena's appointment tomorrow.", recordedBy: andre, recordedAt: at(0, "06:45") });

  // A registered tablet for each home, so the dashboard shows them.
  for (const [name, fid] of [["Cedar Ridge med room", cr], ["Maple House office", mh]] as const) {
    const [d] = await db.insert(devices).values({ orgId, name, tokenHash: sha256(randomToken()), registeredBy: joy, lastSeenAt: new Date(now.getTime() - 2 * 3_600_000) }).returning();
    await db.insert(deviceFacilities).values({ orgId, deviceId: d.id, facilityId: fid });
  }
}

/** The people visitors can be in the demo. */
export const DEMO_ROLES = {
  owner: { email: "joy.okafor@harborviewliving.test", label: "Owner", who: "Joy Okafor" },
  caregiver: { email: "andre.thomas@harborviewliving.test", label: "Med-certified caregiver on the home tablet", who: "Andre Thomas" },
} as const;
export type DemoRole = keyof typeof DEMO_ROLES;

/**
 * For "be the caregiver": makes this browser a tablet at Cedar Ridge, the way an owner would
 * register one, and returns the cookie value.
 */
export async function registerDemoTablet(db: DB): Promise<{ id: string; token: string }> {
  if (!demoMode()) throw new Error("Not the demo app.");
  const [owner] = await db.select().from(users).where(eq(users.email, DEMO_ROLES.owner.email));
  const [cedar] = await db.select({ id: facilities.id }).from(facilities).where(and(eq(facilities.orgId, owner.orgId), eq(facilities.name, "Cedar Ridge")));
  const token = randomToken();
  const [d] = await db.insert(devices).values({ orgId: owner.orgId, name: "Demo tablet", tokenHash: sha256(token), registeredBy: owner.id }).returning();
  await db.insert(deviceFacilities).values({ orgId: owner.orgId, deviceId: d.id, facilityId: cedar.id });
  return { id: d.id, token };
}

/**
 * A made-up clinic visit summary as a one-page PDF, the way a scanned document would arrive. Built
 * by hand with the standard PDF fonts, so it needs no font files on the server.
 */
function visitSummaryPdf(date: string): Buffer {
  const esc = (t: string) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const rows: Array<[string, string]> = [
    ["Patient", "Marcus Bell"],
    ["Date of visit", date],
    ["Seen by", "Dr. Chen, neurology"],
    ["Reason", "Seizure medication review"],
    ["Findings", "No seizures reported in 6 months."],
    ["Plan", "Continue current medication. No changes."],
    ["Follow-up", "Blood test in 2 weeks; next visit in 6 months."],
  ];
  let y = 640;
  const body = [
    "BT /F2 22 Tf 60 720 Td (Riverside Neurology Clinic) Tj ET",
    "BT /F1 12 Tf 60 696 Td (After-visit summary - demo document, not a real patient) Tj ET",
    ...rows.flatMap(([k, v]) => {
      const out = [`BT /F2 12 Tf 60 ${y} Td (${esc(k)}) Tj ET`, `BT /F1 12 Tf 200 ${y} Td (${esc(v)}) Tj ET`, `0.8 G 60 ${y - 8} m 552 ${y - 8} l S`];
      y -= 34;
      return out;
    }),
    "BT /F1 10 Tf 60 80 Td (Riverside Clinic - 100 Example Street - \\(555\\) 010-0100) Tj ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(body)} >>\nstream\n${body}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
