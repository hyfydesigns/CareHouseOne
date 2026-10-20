import { eq } from "drizzle-orm";
import { zipSync, strToU8 } from "fflate";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestDb, type DB } from "@/db/client";
import { medicationCatalog, outbox } from "@/db/schema";
import { candidateReleases, loadedRxTerms, MIN_ROWS, refreshRxTerms } from "@/server/rxterms-refresh";

const HEAD = "RXCUI|GENERIC_RXCUI|TTY|FULL_NAME|RXN_DOSE_FORM|FULL_GENERIC_NAME|BRAND_NAME|DISPLAY_NAME|ROUTE|NEW_DOSE_FORM|STRENGTH|SUPPRESS_FOR|DISPLAY_NAME_SYNONYM|IS_RETIRED|SXDG_RXCUI|SXDG_TTY|SXDG_NAME|PSN";

/** A fake RxTerms zip with `n` distinct medications, laid out like the real file. */
function fakeRelease(n: number, yyyymm = "202610"): Uint8Array {
  const lines = [HEAD];
  for (let i = 0; i < n; i++) lines.push(`${100000 + i}||SCD|x|x|x||Testamine ${i} (Oral Pill)|Oral Pill|Tab|${(i % 9) + 1} mg||||||||`);
  return zipSync({ [`RxTerms${yyyymm}.txt`]: strToU8(lines.join("\n")), [`RxTermsArchive${yyyymm}.txt`]: strToU8("ignored"), "ReleaseNotes.txt": strToU8("notes") });
}

/** Stand-in for NLM's download site: which releases exist, and what's in them. */
function stubNlm(available: Record<string, Uint8Array>) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const m = String(url).match(/RxTerms(\d{6})\.zip$/);
    const body = m ? available[m[1]] : undefined;
    if (!body) return new Response(null, { status: 404 });
    return init?.method === "HEAD" ? new Response(null, { status: 200 }) : new Response(new Blob([new Uint8Array(body)]), { status: 200 });
  });
}

let db: DB;
const now = new Date("2026-10-05T11:00:00Z");

beforeAll(async () => {
  db = await createTestDb();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("quarterly RxTerms update", () => {
  it("looks at this month and the three before", () => {
    expect(candidateReleases(now)).toEqual(["202610", "202609", "202608", "202607"]);
    expect(candidateReleases(new Date("2027-01-05T00:00:00Z"))).toEqual(["202701", "202612", "202611", "202610"]);
  });

  it("loads the newest release, then does nothing until there's a newer one", async () => {
    stubNlm({ "202609": fakeRelease(MIN_ROWS + 50, "202609"), "202608": fakeRelease(MIN_ROWS, "202608") });
    const first = await refreshRxTerms(db, now);
    expect(first).toEqual({ status: "updated", version: "RxTerms 2026-09", count: MIN_ROWS + 50 });
    expect(await loadedRxTerms(db)).toEqual({ version: "RxTerms 2026-09", count: MIN_ROWS + 50 });
    // The starter list is gone; only the release's rows remain.
    expect(await db.select().from(medicationCatalog).where(eq(medicationCatalog.name, "Lisinopril"))).toEqual([]);

    expect(await refreshRxTerms(db, now)).toEqual({ status: "current", version: "RxTerms 2026-09" });
  });

  it("keeps the current list and emails when the new file looks incomplete", async () => {
    vi.stubEnv("OPS_EMAIL", "ops@carehouseone.test");
    stubNlm({ "202610": fakeRelease(500) });
    const r = await refreshRxTerms(db, now);
    expect(r.status).toBe("failed");
    expect(r.status === "failed" && r.error).toMatch(/Only 500 medications/);
    expect((await loadedRxTerms(db)).version).toBe("RxTerms 2026-09");
    const [mail] = await db.select().from(outbox).where(eq(outbox.to, "ops@carehouseone.test"));
    expect(mail.subject).toMatch(/couldn't be updated/);
  });

  it("reports when NLM has nothing recent", async () => {
    stubNlm({});
    const r = await refreshRxTerms(db, now);
    expect(r.status === "failed" && r.error).toMatch(/No RxTerms release found/);
    expect((await loadedRxTerms(db)).count).toBe(MIN_ROWS + 50);
  });
});
