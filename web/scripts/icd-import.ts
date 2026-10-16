/**
 * Loads the official ICD-10-CM code set into icd10_codes.
 *
 * Usage: npm run icd:import -- <path to icd10cm_order_YYYY.txt> "FY 2027"
 *
 * The CMS "order" file is fixed-width: order number (5), blank, code (7), blank, billable flag
 * (1: 1 = valid for claims, 0 = header), blank, short description (60), blank, long description.
 * Run it against the production database as the migration role, once a year before October 1.
 */
import { readFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { getDb } from "../src/db/client";
import { icd10Codes } from "../src/db/schema";

function withDot(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)}.${code.slice(3)}` : code;
}

async function main() {
  const [file, version] = process.argv.slice(2);
  if (!file || !version) {
    console.error('Usage: npm run icd:import -- <icd10cm_order_YYYY.txt> "FY 2027"');
    process.exit(1);
  }
  const rows = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .filter((l) => l.length > 77)
    .map((l) => ({ code: withDot(l.slice(6, 13).trim()), billable: l[14] === "1", description: l.slice(77).trim(), version }));
  if (rows.length < 1000) {
    console.error(`Only ${rows.length} rows parsed; is this the CMS order file?`);
    process.exit(1);
  }
  const db = await getDb();
  for (let i = 0; i < rows.length; i += 1000) {
    await db
      .insert(icd10Codes)
      .values(rows.slice(i, i + 1000))
      .onConflictDoUpdate({ target: icd10Codes.code, set: { description: sql`excluded.description`, billable: sql`excluded.billable`, version: sql`excluded.version` } });
  }
  console.log(`Loaded ${rows.length} ICD-10-CM codes for ${version}.`);
}

main().then(() => process.exit(0));
