/**
 * Seeds the local development database (PGlite in .data/) with the demo organization.
 * Refuses to run against a DATABASE_URL so it can never touch a real database.
 */
import { getDb } from "../src/db/client";
import { organizations } from "../src/db/schema";
import { DEMO_PASSWORD, seedCare, seedDemo, seedDoseHistory } from "../src/server/seed";

async function main() {
  if (process.env.DATABASE_URL) {
    console.error("Refusing to seed: DATABASE_URL is set. The seed is for the local development database only.");
    process.exit(1);
  }
  const db = await getDb();
  const existing = await db.select().from(organizations);
  if (existing.length) {
    console.log("The local database already has data. Delete web/.data to start over.");
    return;
  }
  const s = await seedDemo(db, { fixedTotp: true });
  const care = await seedCare(db, s);
  await seedDoseHistory(db, s, new Date());
  console.log("Seeded Harborview Community Living with Cedar Ridge and Maple House.");
  console.log(`Sign in with any of these and the demo password in src/server/seed.ts (${DEMO_PASSWORD.length} characters):`);
  for (const [k, u] of Object.entries(s.users)) console.log(`  ${k.padEnd(9)} ${u.email}`);
  console.log("Residents and wristband codes (for scanning in the medication pass):");
  for (const [k, r] of Object.entries(care.residents)) console.log(`  ${k.padEnd(9)} ${r.wristbandCode}`);
  console.log("Lena's lisinopril package code: LIS10-LK");
  console.log("Two-step codes for local accounts: npm run dev:code (or add the demo key from seed.ts to an authenticator app).");
}

main().then(() => process.exit(0));
