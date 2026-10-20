import { sql } from "drizzle-orm";
import type { DB } from "@/db/client";
import { medicationCatalog } from "@/db/schema";
import { sendMail } from "./audit";
import { importCatalog, parseRxTerms } from "./medication-catalog";

const BASE = "https://data.lhncbc.nlm.nih.gov/public/rxterms/release";
/** A real RxTerms release has tens of thousands of rows; anything much smaller is a broken download. */
export const MIN_ROWS = 10_000;
const MAX_ZIP_BYTES = 150 * 1024 * 1024;

/** This month and the three before, newest first, as YYYYMM. NLM releases monthly, a little after RxNorm. */
export function candidateReleases(now: Date): string[] {
  return [0, 1, 2, 3].map((back) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1));
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

const label = (yyyymm: string) => `RxTerms ${yyyymm.slice(0, 4)}-${yyyymm.slice(4)}`;

export type RefreshResult = { status: "current" | "updated"; version: string; count?: number } | { status: "failed"; error: string };

/**
 * Loads the newest NLM RxTerms release if it isn't loaded yet. Called quarterly by Cloud Scheduler
 * through /api/cron/rxterms. The list is only replaced when the new one looks complete, in a single
 * transaction, so a bad download never empties it. Failures email OPS_EMAIL (or CONTACT_EMAIL).
 */
export async function refreshRxTerms(db: DB, now = new Date()): Promise<RefreshResult> {
  try {
    const [loaded] = await db.select({ version: medicationCatalog.version }).from(medicationCatalog).limit(1);
    let found: string | null = null;
    for (const yyyymm of candidateReleases(now)) {
      const head = await fetch(`${BASE}/RxTerms${yyyymm}.zip`, { method: "HEAD", signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (head.ok) {
        found = yyyymm;
        break;
      }
    }
    if (!found) throw new Error("No RxTerms release found for the last four months on NLM's site.");
    const version = label(found);
    if (loaded?.version === version) return { status: "current", version };

    const res = await fetch(`${BASE}/RxTerms${found}.zip`, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (!res.ok) throw new Error(`Download failed (${res.status}).`);
    const zip = new Uint8Array(await res.arrayBuffer());
    if (zip.length > MAX_ZIP_BYTES) throw new Error("The download is far larger than expected.");
    const { unzipSync, strFromU8 } = await import("fflate");
    // Only the main file (RxTerms<version>.txt), not the archive or ingredients files.
    const files = unzipSync(zip, { filter: (f) => /(^|\/)RxTerms\d{6}\.txt$/i.test(f.name) });
    const main = Object.values(files)[0];
    if (!main) throw new Error("The zip has no RxTerms<version>.txt file.");
    const rows = parseRxTerms(strFromU8(main));
    if (rows.length < MIN_ROWS) throw new Error(`Only ${rows.length} medications in the new file; keeping the current list.`);
    const count = await importCatalog(db, rows, version);
    console.info(`[rxterms] loaded ${version}: ${count} medications`);
    return { status: "updated", version, count };
  } catch (e) {
    const error = (e as Error).message;
    console.error(`[rxterms] refresh failed: ${error}`);
    const to = process.env.OPS_EMAIL || process.env.CONTACT_EMAIL;
    if (to) {
      await sendMail(db, {
        orgId: null,
        to,
        subject: "CareHouse One: the medication list couldn't be updated",
        body: `The scheduled RxTerms update failed: ${error}\n\nThe current list is unchanged and still works. To update by hand, follow "Medication list" under Routine work in deploy/README.md.`,
      });
    }
    return { status: "failed", error };
  }
}

/** For the runbook and checks: which RxTerms version is loaded, and how many medications. */
export async function loadedRxTerms(db: DB): Promise<{ version: string | null; count: number }> {
  const [r] = await db.select({ version: sql<string | null>`min(${medicationCatalog.version})`, count: sql<number>`count(*)::int` }).from(medicationCatalog);
  return { version: r.version, count: r.count };
}
