import { readFileSync } from "node:fs";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { onboardingForms, outbox } from "@/db/schema";
import { changedSignatures, fillPlaceholders, mergeAnswers, partOf, type Block } from "@/lib/onboarding-forms";
import type { Actor } from "@/lib/permissions";
import { cancelOnboarding, listOnboardings, familySaveValues, familySign, familyView, getOnboarding, packetByToken, resendLink, sendOnboarding, staffSaveValues, startOnboarding } from "@/server/onboarding";
import { residentialAgreement } from "@/server/onboarding-agreement";
import { ensureStarterForms, listForms } from "@/server/onboarding-forms";
import { seedDemo, type Seeded } from "@/server/seed";

let db: DB;
let s: Seeded;
let owner: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const mailsTo = (to: string) => db.select().from(outbox).where(eq(outbox.to, to)).orderBy(desc(outbox.createdAt));
const start = (o: Record<string, unknown>) => ({ facilityId: s.facilities.cedarRidge, residentFirstName: "Ana", residentLastName: "Ruiz", poaName: "Luis Ruiz", ...o });

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  await inOrg((tx) => ensureStarterForms(tx, s.orgId, owner.id));
});

describe("starting an onboarding", () => {
  it("sends only the forms chosen for this resident", async () => {
    const forms = await inOrg((tx) => listForms(tx, owner));
    const chosen = forms.slice(0, 2).map((f) => f.id);
    expect((await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "none@example.com", formIds: [] }), "https://app.test"))).ok).toBe(false);
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "two@example.com", formIds: chosen }), "https://app.test"));
    expect(r.ok).toBe(true);
    const o = await inOrg((tx) => getOnboarding(tx, owner, r.ok ? r.data!.id : ""));
    expect(o!.items.map((i) => i.title)).toEqual(forms.slice(0, 2).map((f) => f.title));
    // Progress counts every form chosen, optional ones included.
    const all = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "all@example.com" }), "https://app.test"));
    const row = (await inOrg((tx) => listOnboardings(tx, owner))).find((x) => all.ok && x.p.id === all.data!.id)!;
    expect(row.total).toBe(forms.length);
    expect(row.optional).toBe(forms.filter((f) => !f.required).length);
    expect(row.optional).toBeGreaterThan(0);
  });

  it("can be filled in by the home first, and the family gets nothing until it's sent", async () => {
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "draft@example.com", draft: true }), "https://app.test"));
    expect(r.ok).toBe(true);
    const id = r.ok ? r.data!.id : "";
    expect(await mailsTo("draft@example.com")).toHaveLength(0);
    let o = await inOrg((tx) => getOnboarding(tx, owner, id));
    expect(o!.p.status).toBe("draft");
    // The home fills in the fees; the room number can stay blank.
    const agreement = o!.items.find((i) => i.title === "Residential Care Home Agreement")!;
    const byLabel = (l: string) => agreement.blocks.find((b) => b.type === "field" && b.label === l)!.id;
    const saved = await inOrg((tx) => staffSaveValues(tx, owner, id, agreement.id, { [byLabel("Agreement date")]: "2026-11-10", [byLabel("Community fee")]: "1000", [byLabel("Monthly fee")]: "2500", [byLabel("Care level")]: "Care Level A" }));
    expect(saved.ok).toBe(true);
    o = await inOrg((tx) => getOnboarding(tx, owner, id));
    expect(o!.items.find((i) => i.id === agreement.id)!.staffMissing.filter((m) => agreement.blocks.some((b) => b.type === "field" && b.label === m))).toEqual([]);
    expect((await inOrg((tx) => resendLink(tx, owner, id, "https://app.test"))).ok).toBe(false);

    expect((await inOrg((tx) => sendOnboarding(tx, owner, id, "https://app.test"))).ok).toBe(true);
    const [mail] = await mailsTo("draft@example.com");
    const token = /\/family\/([A-Za-z0-9_-]+)/.exec(mail.body)![1];
    expect((await packetByToken(db, token))?.id).toBe(id);
    expect((await inOrg((tx) => sendOnboarding(tx, owner, id, "https://app.test"))).ok).toBe(false);
  });

  it("can cancel a draft", async () => {
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "gone@example.com", draft: true }), "https://app.test"));
    expect((await inOrg((tx) => cancelOnboarding(tx, owner, r.ok ? r.data!.id : ""))).ok).toBe(true);
    expect((await inOrg((tx) => sendOnboarding(tx, owner, r.ok ? r.data!.id : "", "https://app.test"))).ok).toBe(false);
  });
});

describe("the agreement's room number", () => {
  it("is optional, including in agreements organizations already added", async () => {
    const room = (blocks: Block[]) => blocks.find((b) => b.type === "field" && b.label === "Room number");
    expect(room(residentialAgreement().blocks)).toMatchObject({ required: false });
    const old = residentialAgreement().blocks.map((b) => (b.type === "field" && b.label === "Room number" ? { ...b, required: true } : b));
    const [row] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Residential Care Home Agreement", kind: "form", blocks: old, position: 99 }).returning();
    for (const part of readFileSync(path.join(process.cwd(), "drizzle", "0034_room_number_optional.sql"), "utf8").split("--> statement-breakpoint")) await db.execute(sql.raw(part));
    const [after] = await db.select().from(onboardingForms).where(eq(onboardingForms.id, row.id));
    expect(room(after.blocks as Block[])).toMatchObject({ required: false });
    expect((after.blocks as Block[]).length).toBe(old.length);
  });
});

describe("responsible party wording", () => {
  it("replaces power of attorney in forms organizations already have, and {{POA name}} still fills in", async () => {
    const old: Block[] = [
      { id: "h1", type: "heading", text: "Power of attorney or guardian" },
      { id: "t1", type: "text", text: "I, {{POA name}}, agree." },
      { id: "s1", type: "signature", label: "Power of attorney or guardian", who: "poa" },
    ];
    const [row] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Power of attorney and emergency contacts", kind: "form", blocks: old, position: 98 }).returning();
    for (const part of readFileSync(path.join(process.cwd(), "drizzle", "0035_responsible_party_wording.sql"), "utf8").split("--> statement-breakpoint")) await db.execute(sql.raw(part));
    const [after] = await db.select().from(onboardingForms).where(eq(onboardingForms.id, row.id));
    expect(after.title).toBe("Responsible party and emergency contacts");
    expect(after.blocks).toEqual([
      { id: "h1", type: "heading", text: "Responsible party" },
      { id: "t1", type: "text", text: "I, {{Responsible party}}, agree." },
      { id: "s1", type: "signature", label: "Responsible party", who: "poa" },
    ]);
    const ctx = { Organization: "", "Home name": "", "Home address": "", "Home phone": "", "Home fax": "", "Home email": "", "Resident name": "", "Responsible party": "Luis Ruiz" };
    expect(fillPlaceholders([old[1]], ctx)).toEqual([{ ...old[1], text: "I, Luis Ruiz, agree." }]);
  });
});

describe("a family member as responsible party", () => {
  it("is a choice for their authority, and legal papers become optional, in forms organizations already have", async () => {
    const authority: Block = { id: "au1", type: "field", label: "Your authority", input: "choice", required: true, who: "poa", options: ["Health care power of attorney", "Court-appointed guardian", "Representative payee", "Other"] };
    const [form] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Responsible party and emergency contacts", kind: "form", blocks: [authority], position: 97 }).returning();
    const [papers] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Power of attorney or guardianship papers", description: "A copy of the signed power of attorney or the court's guardianship order.", kind: "upload", required: true, blocks: [], position: 96 }).returning();
    for (let run = 0; run < 2; run++) {
      for (const part of readFileSync(path.join(process.cwd(), "drizzle", "0036_family_member_responsible_party.sql"), "utf8").split("--> statement-breakpoint")) await db.execute(sql.raw(part));
    }
    const [f] = await db.select().from(onboardingForms).where(eq(onboardingForms.id, form.id));
    expect((f.blocks as Block[])[0]).toMatchObject({ options: ["Health care power of attorney", "Court-appointed guardian", "Representative payee", "Family member (no legal papers)", "Other"] });
    expect(f.version).toBe(2);
    const [u] = await db.select().from(onboardingForms).where(eq(onboardingForms.id, papers.id));
    expect(u.required).toBe(false);
  });
});

describe("signing a long form part by part", () => {
  it("sees on the page which signatures an edit clears, the same way saving will", () => {
    const blocks: Block[] = [
      { id: "fee0", type: "field", label: "Monthly fee", input: "money", required: true, who: "staff" },
      { id: "qone", type: "field", label: "Your phone", input: "text", required: true, who: "poa" },
      { id: "sone", type: "signature", label: "Part 1", who: "poa" },
      { id: "qtwo", type: "field", label: "Your address", input: "text", required: true, who: "poa" },
      { id: "stwo", type: "signature", label: "Part 2", who: "poa" },
    ];
    const saved = { fee0: "2500.00", qone: "713", qtwo: "Elm" };
    const typed = (v: Record<string, string>) => changedSignatures("Form", blocks, saved, mergeAnswers(blocks, saved, v, "poa"), ["sone", "stwo"]);
    // The page holds the family's answers as typed, and the home's as saved.
    expect(typed(saved)).toEqual([]);
    expect(typed({ ...saved, qone: " 713 " })).toEqual([]);
    expect(typed({ ...saved, qtwo: "Oak" })).toEqual(["stwo"]);
    expect(typed({ ...saved, qone: "" })).toEqual(["sone"]);
  });

  it("treats signature lines directly together as one part", () => {
    const sign = (id: string, who: "poa" | "staff"): Block => ({ id, type: "signature", label: id, who });
    const text = (id: string): Block => ({ id, type: "text", text: id });
    const blocks = [text("aaaa"), sign("fam1", "poa"), sign("home1", "staff"), text("bbbb"), sign("fam2", "poa"), sign("home2", "staff")];
    expect(partOf(blocks, "home1").map((b) => b.id)).toEqual(["aaaa", "fam1", "home1"]);
    expect(partOf(blocks, "fam2").map((b) => b.id)).toEqual(["bbbb", "fam2"]);
    expect(partOf(blocks, "home2").map((b) => b.id)).toEqual(["bbbb", "fam2", "home2"]);
  });

  it("each signature needs only its part's answers, and a change clears only the parts showing that answer", async () => {
    const blocks: Block[] = [
      { id: "fee0", type: "field", label: "Monthly fee", input: "money", required: true, who: "staff" },
      { id: "qone", type: "field", label: "Your phone", input: "text", required: true, who: "poa" },
      { id: "sone", type: "signature", label: "Responsible party (part 1)", who: "poa" },
      { id: "ttwo", type: "text", text: "I guarantee the Monthly Fee of {{Monthly fee}}." },
      { id: "qtwo", type: "field", label: "Guarantor's address", input: "long", required: true, who: "poa" },
      { id: "stwo", type: "signature", label: "Guarantor (part 2)", who: "poa" },
    ];
    const [form] = await db.insert(onboardingForms).values({ orgId: s.orgId, title: "Two-part form", kind: "form", blocks, position: 95 }).returning();
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start({ poaEmail: "parts@example.com", formIds: [form.id], draft: true }), "https://app.test"));
    const id = r.ok ? r.data!.id : "";
    const itemId = (await inOrg((tx) => getOnboarding(tx, owner, id)))!.items[0].id;
    expect((await inOrg((tx) => staffSaveValues(tx, owner, id, itemId, { fee0: "2500" }))).ok).toBe(true);
    await inOrg((tx) => sendOnboarding(tx, owner, id, "https://app.test"));
    const p = (await packetByToken(db, /\/family\/([A-Za-z0-9_-]+)/.exec((await mailsTo("parts@example.com"))[0].body)![1]))!;
    const fam = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, p.orgId, fn);
    const sig = { name: "Luis Ruiz", method: "typed", consent: true };
    const signatures = async () => Object.keys((await fam((tx) => familyView(tx, p))).items[0].signatures).sort();

    // Part 1 can't be signed until its question is answered; part 2's question can wait.
    expect((await fam((tx) => familySign(tx, p, itemId, "sone", sig, {}))).ok).toBe(false);
    await fam((tx) => familySaveValues(tx, p, itemId, { qone: "713-555-0100" }));
    const s1 = await fam((tx) => familySign(tx, p, itemId, "sone", sig, {}));
    expect(s1.ok, s1.ok ? "" : s1.error).toBe(true);
    expect((await fam((tx) => familySign(tx, p, itemId, "stwo", sig, {}))).ok).toBe(false);
    // Answering part 2 leaves part 1's signature in place.
    await fam((tx) => familySaveValues(tx, p, itemId, { qone: "713-555-0100", qtwo: "12 Elm St" }));
    expect((await fam((tx) => familySign(tx, p, itemId, "stwo", sig, {}))).ok).toBe(true);
    expect(await signatures()).toEqual(["sone", "stwo"]);
    // Changing part 2's answer clears only part 2's signature.
    const changed = await fam((tx) => familySaveValues(tx, p, itemId, { qone: "713-555-0100", qtwo: "14 Elm St" }));
    expect(changed.ok && changed.message).toMatch(/signed again/);
    expect(await signatures()).toEqual(["sone"]);
    await fam((tx) => familySign(tx, p, itemId, "stwo", sig, {}));
    // Changing part 1's answer clears only part 1's signature, not the part below it.
    await fam((tx) => familySaveValues(tx, p, itemId, { qone: "713-555-0199", qtwo: "14 Elm St" }));
    expect(await signatures()).toEqual(["stwo"]);
    await fam((tx) => familySign(tx, p, itemId, "sone", sig, {}));
    // The fee is above part 1 and quoted in part 2, so changing it clears both.
    await inOrg((tx) => staffSaveValues(tx, owner, id, itemId, { fee0: "2600" }));
    expect(await signatures()).toEqual([]);
  });
});
