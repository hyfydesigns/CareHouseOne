import { readFileSync } from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createTestDb } from "@/db/client";
import { onboardingForms } from "@/db/schema";
import { answerText, cleanValues, withAnswers, type Block } from "@/lib/onboarding-forms";
import { residentialAgreement } from "@/server/onboarding-agreement";
import { seedDemo } from "@/server/seed";

const fee: Extract<Block, { type: "field" }> = { id: "fee0001", type: "field", label: "Monthly fee", input: "money", required: true, who: "staff" };

describe("amount answers", () => {
  it("accept 1000, $1,000 or 1000.5 and always show as currency", () => {
    for (const [typed, shown] of [["1000", "$1,000.00"], ["$1,000", "$1,000.00"], ["2500.5", "$2,500.50"], [" $ 3,200.00 ", "$3,200.00"]]) {
      const clean = cleanValues([fee], { fee0001: typed }, "staff");
      expect(clean.fee0001).toMatch(/^\d+\.\d\d$/);
      expect(answerText(fee, clean.fee0001)).toBe(shown);
    }
    expect(cleanValues([fee], { fee0001: "about a thousand" }, "staff")).toEqual({});
    expect(withAnswers("Your Monthly Fee is {{Monthly fee}} for each month.", [fee], { fee0001: "2500.00" })).toBe("Your Monthly Fee is $2,500.00 for each month.");
  });

  it("are used for the agreement's fees, including agreements organizations already added", async () => {
    const fees = residentialAgreement().blocks.filter((b) => b.type === "field" && /fee$/i.test(b.label));
    expect(fees.map((b) => b.type === "field" && b.input)).toEqual(["money", "money"]);
    // An agreement added before amounts existed, with the fees as short answers.
    const db = await createTestDb();
    const s = await seedDemo(db);
    const old = residentialAgreement().blocks.map((b) => (b.type === "field" && /fee$/i.test(b.label) ? { ...b, input: "text", help: "For example: $2,500.00" } : b));
    const [row] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Residential Care Home Agreement", kind: "form", blocks: old, position: 1 }).returning();
    await db.execute(sql.raw(readFileSync(path.join(process.cwd(), "drizzle", "0033_agreement_fees_as_amounts.sql"), "utf8")));
    const [after] = await db.select().from(onboardingForms).where(eq(onboardingForms.id, row.id));
    const blocks = after.blocks as Block[];
    expect(blocks.filter((b) => b.type === "field" && /fee$/i.test(b.label)).map((b) => b.type === "field" && b.input)).toEqual(["money", "money"]);
    expect(blocks.length).toBe(old.length);
    expect(blocks.map((b) => b.id)).toEqual(old.map((b) => b.id));
    expect(after.version).toBe(2);
  });
});
