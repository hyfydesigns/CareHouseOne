import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { outbox, staffCertifications, staffDocuments, users } from "@/db/schema";
import { formSchema, type Block } from "@/lib/onboarding-forms";
import type { Actor } from "@/lib/permissions";
import {
  admitOnboarding,
  familyDocument,
  familySaveValues,
  familySign,
  familySubmit,
  familyUpload,
  familyView,
  getOnboarding,
  hireOnboarding,
  listOnboardings,
  packetByToken,
  reviewItem,
  staffSaveValues,
  staffSign,
  startOnboarding,
} from "@/server/onboarding";
import { ensureStarterForms, listForms } from "@/server/onboarding-forms";
import { renderOnboardingPdf } from "@/server/onboarding-pdf";
import { staffStarterForms } from "@/server/onboarding-staff-starters";
import { seedDemo, type Seeded } from "@/server/seed";
import { addStaffDocument, getStaffDocument, listStaffDocuments, removeStaffDocument, staffDocCategoryFor } from "@/server/staff-documents";

let db: DB;
let s: Seeded;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const url = "https://app.test";
const sig = { name: "Dana Lee", method: "typed", consent: true };
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const mails = (to: string) => db.select().from(outbox).where(eq(outbox.to, to)).orderBy(desc(outbox.createdAt));
const tokenIn = (body: string) => /\/family\/([A-Za-z0-9_-]+)/.exec(body)![1];
type Item = NonNullable<Awaited<ReturnType<typeof getOnboarding>>>["items"][number];

const answer = (b: Extract<Block, { type: "field" }>) => (b.input === "date" ? "2027-06-01" : b.input === "check" || b.input === "yesno" ? "yes" : b.input === "choice" ? b.options![0] : "Sample");
const answers = (i: Item, who: "poa" | "staff") => Object.fromEntries(i.blocks.flatMap((b) => (b.type === "field" && b.who === who ? [[b.id, answer(b)]] : [])));

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("the staff starter forms", () => {
  it("are valid forms, never ask for a Social Security number, and carry no other state or business's wording", () => {
    const forms = staffStarterForms();
    for (const f of forms) expect(formSchema.safeParse(f).success, f.title).toBe(true);
    const text = JSON.stringify(forms);
    expect(text).not.toMatch(/social security|\bssn\b|\bss no\b/i);
    expect(text).not.toMatch(/arizona|AC Assisted|HIPPA|azdps/i);
    const ids = forms.flatMap((f) => f.blocks.map((b) => b.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("are kept apart from the residents' forms", async () => {
    await inOrg((tx) => ensureStarterForms(tx, s.orgId, owner.id));
    const before = (await inOrg((tx) => listForms(tx, owner))).length;
    await inOrg((tx) => ensureStarterForms(tx, s.orgId, owner.id, "staff"));
    expect((await inOrg((tx) => listForms(tx, owner))).length).toBe(before);
    expect((await inOrg((tx) => listForms(tx, owner, { audience: "staff" }))).map((f) => f.title)).toContain("Employment application");
  });
});

describe("hiring through onboarding", () => {
  const email = "dana@example.com";
  let id = "";

  it("runs from the link to the staff account, and keeps the home's records from the employee", async () => {
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, { audience: "staff", facilityId: s.facilities.cedarRidge, residentFirstName: "Dana", residentLastName: "Lee", poaEmail: email }, url));
    expect(r.ok).toBe(true);
    id = r.ok ? r.data!.id : "";
    expect((await inOrg((tx) => listOnboardings(tx, owner))).some((x) => x.p.id === id)).toBe(false);
    expect((await inOrg((tx) => listOnboardings(tx, owner, "staff"))).some((x) => x.p.id === id)).toBe(true);
    let o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    expect(o.p.poaName).toBe("Dana Lee");
    const hipaa = o.items.find((i) => i.title.startsWith("HIPAA"))!;
    expect(JSON.stringify(hipaa.blocks)).toContain("I, Dana Lee, do hereby agree");

    let p = (await packetByToken(db, tokenIn((await mails(email))[0].body)))!;
    const fam = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, p.orgId, fn);
    const seen = (await fam((tx) => familyView(tx, p))).items.map((i) => i.title);
    expect(seen).toContain("Employment application");
    for (const hidden of ["Reference and employment checks", "Interview and hiring record", "Employee orientation", "Caregiver skills checklist"]) expect(seen).not.toContain(hidden);
    const orientation = o.items.find((i) => i.title === "Employee orientation")!;
    expect((await fam((tx) => familySaveValues(tx, p, orientation.id, answers(orientation, "poa")))).ok).toBe(false);
    expect((await fam((tx) => familySubmit(tx, p, orientation.id))).ok).toBe(false);

    // The home fills in its part first; the employee completes and signs the rest.
    for (const i of o.items.filter((x) => !x.afterHire && !x.homeOnly)) {
      if (i.kind === "form") {
        await inOrg((tx) => staffSaveValues(tx, owner, id, i.id, answers(i, "staff")));
        await fam((tx) => familySaveValues(tx, p, i.id, answers(i, "poa")));
        for (const b of i.blocks) if (b.type === "signature" && b.who === "poa") expect((await fam((tx) => familySign(tx, p, i.id, b.id, sig, {}))).ok).toBe(true);
      } else {
        expect((await fam((tx) => familyUpload(tx, p, i.id, { name: "card.pdf", data: pdf }))).ok).toBe(true);
      }
      const sent = await fam((tx) => familySubmit(tx, p, i.id));
      expect(sent.ok, `${i.title}: ${sent.ok ? "" : sent.error}`).toBe(true);
    }

    // Hiring waits for the forms before hire, not the ones done on the job.
    const hire = (raw: unknown) => inOrg((tx) => hireOnboarding(tx, owner, id, raw, renderOnboardingPdf, url));
    const job = { role: "caregiver", facilityIds: [s.facilities.cedarRidge] };
    expect((await hire(job)).ok).toBe(false);
    o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    for (const i of o.items.filter((x) => !x.afterHire && x.required)) {
      for (const b of i.blocks) if (b.type === "signature" && b.who === "staff") await inOrg((tx) => staffSign(tx, owner, id, i.id, b.id, { ...sig, name: "Joy Owner" }, {}));
      const ok = await inOrg((tx) => reviewItem(tx, owner, id, i.id, "approve", ""));
      expect(ok.ok, `${i.title}: ${ok.ok ? "" : ok.error}`).toBe(true);
    }
    // A home-only record approved before hire stays off the employee's copies.
    const checks = o.items.find((i) => i.title === "Reference and employment checks")!;
    await inOrg((tx) => staffSign(tx, owner, id, checks.id, checks.blocks.find((b) => b.type === "signature")!.id, { ...sig, name: "Joy Owner" }, {}));
    expect((await inOrg((tx) => reviewItem(tx, owner, id, checks.id, "approve", ""))).ok).toBe(true);

    expect((await inOrg((tx) => hireOnboarding(tx, caregiver, id, job, renderOnboardingPdf, url))).ok).toBe(false);
    expect((await hire({ ...job, role: "" })).ok).toBe(false);
    expect((await inOrg((tx) => admitOnboarding(tx, owner, id, { firstName: "Dana", lastName: "Lee" }, renderOnboardingPdf, url))).ok).toBe(false);
    const hired = await hire(job);
    expect(hired.ok, hired.ok ? "" : hired.error).toBe(true);
    const userId = hired.ok ? hired.data!.userId : "";
    const [u] = await db.select().from(users).where(eq(users.id, userId));
    expect(u).toMatchObject({ email, name: "Dana Lee", role: "caregiver", status: "invited" });
    expect((await mails(email)).map((m) => m.subject)).toContain("You're invited to CareHouse One");

    const docs = await inOrg((tx) => listStaffDocuments(tx, owner, userId));
    expect(docs.map((d) => d.title)).toContain("Employment application (signed)");
    expect(docs.find((d) => d.title.startsWith("Reference"))?.source).toBe("onboarding_internal");
    const certs = await db.select().from(staffCertifications).where(eq(staffCertifications.userId, userId));
    expect(certs.find((c) => c.kind === "cpr")?.expiresOn).toBe("2027-06-01");

    // The employee gets their copies, not the home's records, and the on-the-job forms open up.
    const link = (await mails(email)).find((m) => m.subject.includes("signed paperwork"))!;
    p = (await packetByToken(db, tokenIn(link.body)))!;
    const view = await fam((tx) => familyView(tx, p));
    expect(view.items.map((i) => i.title).sort()).toEqual(["Caregiver skills checklist", "Employee orientation"]);
    expect(view.documents.map((d) => d.title)).toContain("Employment application (signed)");
    expect(view.documents.some((d) => d.title.startsWith("Reference"))).toBe(false);
    const internal = docs.find((d) => d.title.startsWith("Reference"))!;
    expect(await fam((tx) => familyDocument(tx, p, internal.id))).toBeNull();
    expect((await fam((tx) => familySaveValues(tx, p, o.items.find((i) => i.title === "Disclosure")!.id, {}))).ok).toBe(false);

    // Finishing a form on the job files it straight onto their record.
    const fresh = (await inOrg((tx) => getOnboarding(tx, owner, id)))!.items.find((i) => i.title === "Employee orientation")!;
    await inOrg((tx) => staffSaveValues(tx, owner, id, fresh.id, answers(fresh, "staff")));
    await fam((tx) => familySaveValues(tx, p, fresh.id, answers(fresh, "poa")));
    for (const b of fresh.blocks) {
      if (b.type !== "signature") continue;
      const signed = b.who === "poa" ? await fam((tx) => familySign(tx, p, fresh.id, b.id, sig, {})) : await inOrg((tx) => staffSign(tx, owner, id, fresh.id, b.id, { ...sig, name: "Joy Owner" }, {}));
      expect(signed.ok).toBe(true);
    }
    expect((await fam((tx) => familySubmit(tx, p, fresh.id))).ok).toBe(true);
    expect((await inOrg((tx) => reviewItem(tx, owner, id, fresh.id, "approve", "", new Date(), renderOnboardingPdf))).ok).toBe(true);
    expect((await inOrg((tx) => listStaffDocuments(tx, owner, userId))).map((d) => d.title)).toContain("Employee orientation (signed)");
  });

  it("won't hire someone who already has an account here", async () => {
    const forms = await inOrg((tx) => listForms(tx, owner, { audience: "staff" }));
    const only = forms.find((f) => f.title === "Interview and hiring record")!;
    const again = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, { audience: "staff", facilityId: s.facilities.cedarRidge, residentFirstName: "Dana", residentLastName: "Lee", poaEmail: email, formIds: [only.id] }, url));
    const dup = await inOrg((tx) => hireOnboarding(tx, owner, again.ok ? again.data!.id : "", { role: "caregiver", facilityIds: [s.facilities.cedarRidge] }, renderOnboardingPdf, url));
    expect(dup.ok).toBe(false);
  });
});

describe("staff documents", () => {
  it("are for owners and admins, can be added by hand, and are removed with a reason", async () => {
    const upload = { name: "cpr.pdf", data: pdf, title: "CPR card", category: "training" };
    expect((await inOrg((tx) => addStaffDocument(tx, caregiver, s.users.caregiver.id, upload))).ok).toBe(false);
    const r = await inOrg((tx) => addStaffDocument(tx, owner, s.users.caregiver.id, upload));
    expect(r.ok).toBe(true);
    const docId = r.ok ? r.data!.id : "";
    expect(await inOrg((tx) => getStaffDocument(tx, caregiver, docId))).toBeNull();
    expect((await inOrg((tx) => removeStaffDocument(tx, owner, docId, ""))).ok).toBe(false);
    expect((await inOrg((tx) => removeStaffDocument(tx, owner, docId, "Uploaded twice"))).ok).toBe(true);
    expect(await inOrg((tx) => getStaffDocument(tx, owner, docId))).toBeNull();
    const [kept] = await db.select().from(staffDocuments).where(eq(staffDocuments.id, docId));
    expect(kept.removedReason).toBe("Uploaded twice");
  });

  it("are sorted from the form's title", () => {
    expect(staffDocCategoryFor("Fingerprint clearance")).toBe("clearance");
    expect(staffDocCategoryFor("Employee orientation (signed)")).toBe("training");
    expect(staffDocCategoryFor("HIPAA and non-compete agreement (signed)")).toBe("agreements");
    expect(staffDocCategoryFor("Employment application (signed)")).toBe("hiring");
  });
});
