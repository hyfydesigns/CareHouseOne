import { readFileSync } from "node:fs";
import path from "node:path";
import { desc, eq, sql } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { onboardingForms, outbox } from "@/db/schema";
import { fillPlaceholders, type Block } from "@/lib/onboarding-forms";
import type { Actor } from "@/lib/permissions";
import { cancelOnboarding, getOnboarding, packetByToken, resendLink, sendOnboarding, staffSaveValues, startOnboarding } from "@/server/onboarding";
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
