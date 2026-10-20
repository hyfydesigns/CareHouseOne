/**
 * Loads the medication list used for typeahead when entering orders.
 *
 *   npm run rx:import -- RxTerms202610.txt "RxTerms 2026-10"     the full NLM RxTerms list
 *   npm run rx:import -- --sample                                 the built-in starter list
 *
 * RxTerms is free from the US National Library of Medicine:
 * https://lhncbc.nlm.nih.gov/MOR/RxTerms/ (unzip and use RxTerms<version>.txt). It's updated
 * monthly; reloading a few times a year is plenty. Each run replaces the whole list. Needs
 * DATABASE_URL for production (through the Cloud SQL Auth Proxy, see deploy/README.md).
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db/client";
import { SAMPLE_CATALOG } from "../src/server/med-sample";
import { importCatalog, parseRxTerms } from "../src/server/medication-catalog";

async function main() {
  const args = process.argv.slice(2);
  const db = await getDb();
  if (args.includes("--sample")) {
    const n = await importCatalog(db, SAMPLE_CATALOG, "starter list");
    console.log(`Loaded the starter list: ${n} medications.`);
    process.exit(0);
  }
  const [file, version] = args;
  if (!file) throw new Error('Usage: npm run rx:import -- RxTerms202610.txt "RxTerms 2026-10"   (or --sample)');
  const rows = parseRxTerms(readFileSync(file, "utf8"));
  if (rows.length < 1000) throw new Error(`Only ${rows.length} medications found. Is this the main RxTerms<version>.txt file?`);
  const n = await importCatalog(db, rows, version || file.replace(/^.*[\\/]/, "").replace(/\.txt$/i, ""));
  console.log(`Loaded ${n} medications.`);
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
