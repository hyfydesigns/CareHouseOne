import { and, eq } from "drizzle-orm";
import { PDFDocument, PDFName } from "pdf-lib";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { residentDocuments, staffDocuments } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { admitOnboarding, blankFormOf, printHomes, familyView, getOnboarding, hireOnboarding, paperCopyOf, paperUndo, paperUpload, startOnboarding } from "@/server/onboarding";
import { ensureStarterForms, listForms } from "@/server/onboarding-forms";
import { renderOnboardingPdf, renderPaperFormPdf } from "@/server/onboarding-pdf";
import { seedDemo, type Seeded } from "@/server/seed";

let db: DB;
let s: Seeded;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const url = "https://app.test";
const scan = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  await inOrg((tx) => ensureStarterForms(tx, s.orgId, owner.id));
  await inOrg((tx) => ensureStarterForms(tx, s.orgId, owner.id, "staff"));
});

describe("blank forms to print", () => {
  it("print every starter form, for residents and staff, as a PDF; owners and admins only", async () => {
    for (const audience of ["resident", "staff"] as const) {
      const forms = (await inOrg((tx) => listForms(tx, owner, { audience }))).filter((f) => f.kind === "form");
      expect(forms.length).toBeGreaterThan(3);
      for (const f of forms) {
        const c = (await inOrg((tx) => blankFormOf(tx, owner, f.id)))!;
        expect(c.form.title).toBe(f.title);
        // The organization's name is filled in; nothing is left as a {{placeholder}}.
        expect(JSON.stringify(c.form.blocks)).not.toMatch(/\{\{\s*(Organization|Home name)\s*\}\}/i);
        const pdf = await renderPaperFormPdf(c.form, c.head);
        const doc = await PDFDocument.load(pdf);
        expect(doc.getPageCount(), f.title).toBeGreaterThan(0);
      }
      expect(await inOrg((tx) => blankFormOf(tx, caregiver, forms[0].id))).toBeNull();
    }
  });

  it("puts the chosen home's details and the organization's logo on the blank copy", async () => {
    const [form] = (await inOrg((tx) => listForms(tx, owner))).filter((f) => f.kind === "form");
    const homes = await inOrg((tx) => printHomes(tx, owner, s.orgId));
    expect(homes.map((h) => h.id).sort()).toEqual([s.facilities.cedarRidge, s.facilities.mapleHouse].sort());
    // An owner with two homes gets none unless one is chosen.
    expect((await inOrg((tx) => blankFormOf(tx, owner, form.id)))!.head.home).toBe("");
    const maple = (await inOrg((tx) => blankFormOf(tx, owner, form.id, s.facilities.mapleHouse)))!;
    expect(maple.head.home).toBe(homes.find((h) => h.id === s.facilities.mapleHouse)!.name);
    expect((await inOrg((tx) => blankFormOf(tx, owner, form.id, null)))!.head.home).toBe("");
    // A home that isn't theirs prints nothing.
    expect(await inOrg((tx) => blankFormOf(tx, owner, form.id, "00000000-0000-0000-0000-000000000000"))).toBeNull();

    // The logo is drawn at the top of the first page.
    const png = await sharp({ create: { width: 120, height: 60, channels: 3, background: "#3355aa" } }).png().toBuffer();
    const withLogo = await renderPaperFormPdf(maple.form, { ...maple.head, logo: png });
    const without = await renderPaperFormPdf(maple.form, { ...maple.head, logo: null });
    const images = async (pdf: Buffer) => (await PDFDocument.load(pdf)).context.enumerateIndirectObjects().filter(([, o]) => String((o as { dict?: { get: (k: unknown) => unknown } }).dict?.get?.(PDFName.of("Subtype"))) === "/Image").length;
    expect(await images(withLogo)).toBe(1);
    expect(await images(without)).toBe(0);
  });
});

describe("a form done on paper", () => {
  it("counts as done once the signed scan is uploaded, leaves the family's checklist, and is filed on admission", async () => {
    const forms = (await inOrg((tx) => listForms(tx, owner))).filter((f) => f.kind === "form" && f.required);
    const [paper, online] = forms;
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, { facilityId: s.facilities.cedarRidge, residentFirstName: "Ana", residentLastName: "Paper", poaName: "Luis Paper", poaEmail: "luis.paper@example.com", formIds: [paper.id, online.id] }, url));
    const id = r.ok ? r.data!.id : "";
    let o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    const item = o.items.find((i) => i.title === paper.title)!;

    // The printed copy carries the names.
    const copy = (await inOrg((tx) => paperCopyOf(tx, owner, id, item.id)))!;
    expect(copy.form.names).toEqual({ resident: "Ana Paper", person: "Luis Paper" });
    expect((await PDFDocument.load(await renderPaperFormPdf(copy.form, copy.head))).getPageCount()).toBeGreaterThan(0);
    expect(await inOrg((tx) => paperCopyOf(tx, caregiver, id, item.id))).toBeNull();

    expect((await inOrg((tx) => paperUpload(tx, caregiver, id, item.id, { name: "scan.pdf", data: scan }))).ok).toBe(false);
    expect((await inOrg((tx) => paperUpload(tx, owner, id, item.id, { name: "notes.txt", data: Buffer.from("hello") }))).ok).toBe(false);
    expect((await inOrg((tx) => paperUpload(tx, owner, id, item.id, { name: "scan.pdf", data: scan }))).ok).toBe(true);
    o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    let done = o.items.find((i) => i.id === item.id)!;
    expect(done).toMatchObject({ paper: true, status: "approved", poaMissing: [], staffMissing: [] });
    expect(done.files).toHaveLength(1);
    expect((await inOrg((tx) => familyView(tx, o.p))).items.map((i) => i.id)).not.toContain(item.id);

    // Taken back off, it's an online form again; then the right scan goes on, two pages.
    expect((await inOrg((tx) => paperUndo(tx, owner, id, item.id))).ok).toBe(true);
    o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    expect(o.items.find((i) => i.id === item.id)).toMatchObject({ paper: false, status: "todo", files: [] });
    await inOrg((tx) => paperUpload(tx, owner, id, item.id, { name: "page1.pdf", data: scan }));
    await inOrg((tx) => paperUpload(tx, owner, id, item.id, { name: "page2.pdf", data: scan }));

    // Admission still waits on the other form; done on paper too, it goes through.
    expect((await inOrg((tx) => admitOnboarding(tx, owner, id, { firstName: "Ana", lastName: "Paper" }, renderOnboardingPdf, url))).ok).toBe(false);
    const other = o.items.find((i) => i.title === online.title)!;
    await inOrg((tx) => paperUpload(tx, owner, id, other.id, { name: "other.pdf", data: scan }));
    const admitted = await inOrg((tx) => admitOnboarding(tx, owner, id, { firstName: "Ana", lastName: "Paper" }, renderOnboardingPdf, url));
    expect(admitted.ok).toBe(true);
    const residentId = admitted.ok ? admitted.data!.residentId : "";
    const titles = (await db.select({ title: residentDocuments.title }).from(residentDocuments).where(eq(residentDocuments.residentId, residentId))).map((d) => d.title);
    expect(titles).toEqual(expect.arrayContaining([`${paper.title} (signed paper copy, 1 of 2)`, `${paper.title} (signed paper copy, 2 of 2)`, `${online.title} (signed paper copy)`]));
    expect(titles.some((t) => t.endsWith("(signed)"))).toBe(false);
    // Once filed, the paper copy stays.
    expect((await inOrg((tx) => paperUndo(tx, owner, id, item.id))).ok).toBe(false);
    done = (await inOrg((tx) => getOnboarding(tx, owner, id)))!.items.find((i) => i.id === item.id)!;
    expect(done.paper).toBe(true);
  });

  it("for a new hire: filed with their documents at hire, and straight away for a form done on the job", async () => {
    const forms = await inOrg((tx) => listForms(tx, owner, { audience: "staff" }));
    const application = forms.find((f) => f.title === "Employment application")!;
    const orientation = forms.find((f) => f.afterHire && f.kind === "form" && /orientation/i.test(f.title))!;
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, { audience: "staff", facilityId: s.facilities.cedarRidge, residentFirstName: "Pat", residentLastName: "Paper", poaEmail: "pat.paper@example.com", formIds: [application.id, orientation.id] }, url));
    const id = r.ok ? r.data!.id : "";
    let o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    const app = o.items.find((i) => i.title === application.title)!;
    const ori = o.items.find((i) => i.title === orientation.title)!;
    expect((await inOrg((tx) => paperCopyOf(tx, owner, id, app.id)))!.form.names).toEqual({ person: "Pat Paper" });
    await inOrg((tx) => paperUpload(tx, owner, id, app.id, { name: "application.pdf", data: scan }));
    const hired = await inOrg((tx) => hireOnboarding(tx, owner, id, { role: "caregiver", facilityIds: [s.facilities.cedarRidge] }, renderOnboardingPdf, url));
    expect(hired.ok).toBe(true);
    const userId = hired.ok ? hired.data!.userId : "";
    const docs = async () => (await db.select({ title: staffDocuments.title }).from(staffDocuments).where(and(eq(staffDocuments.userId, userId)))).map((d) => d.title);
    expect(await docs()).toEqual([`${application.title} (signed paper copy)`]);
    expect((await inOrg((tx) => paperUpload(tx, owner, id, ori.id, { name: "orientation.pdf", data: scan }))).ok).toBe(true);
    expect(await docs()).toContain(`${orientation.title} (signed paper copy)`);
    o = (await inOrg((tx) => getOnboarding(tx, owner, id)))!;
    expect(o.items.find((i) => i.id === ori.id)).toMatchObject({ paper: true, status: "approved" });
    // A form done before hire is closed now.
    expect((await inOrg((tx) => paperUpload(tx, owner, id, app.id, { name: "again.pdf", data: scan }))).ok).toBe(false);
  });
});
