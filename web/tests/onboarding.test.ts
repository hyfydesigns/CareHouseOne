import { desc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { facilities, onboardingSignatures, organizations, outbox, residentDocuments, residents } from "@/db/schema";
import { withAnswers } from "@/lib/onboarding-forms";
import type { Actor } from "@/lib/permissions";
import { listDocuments } from "@/server/documents";
import {
  admitOnboarding,
  familyDocument,
  familySaveValues,
  familySession,
  familySign,
  familySubmit,
  familyUpload,
  familyView,
  getOnboarding,
  packetByToken,
  reviewItem,
  sendCode,
  staffSaveValues,
  staffSign,
  startOnboarding,
  verifyCode,
} from "@/server/onboarding";
import { listForms, saveForm } from "@/server/onboarding-forms";
import { renderOnboardingPdf } from "@/server/onboarding-pdf";
import { seedDemo, type Seeded } from "@/server/seed";

let db: DB;
let s: Seeded;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const now = new Date("2026-11-03T15:00:00Z");
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");
const lastMailTo = async (to: string) => (await db.select().from(outbox).where(eq(outbox.to, to)).orderBy(desc(outbox.createdAt)))[0];
const tokenIn = (body: string) => /\/family\/([A-Za-z0-9_-]+)/.exec(body)![1];
const typed = (name: string) => ({ name, method: "typed", consent: true });

let packetId = "";
let token = "";

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("onboarding forms", () => {
  it("start with the starter forms, which owners can edit", async () => {
    // The home's address and the organization's logo go on the forms.
    await db.update(facilities).set({ street: "3915 Tidewater Dr", city: "Houston", state: "TX", zip: "77045", phone: "713-900-9389" }).where(eq(facilities.id, s.facilities.cedarRidge));
    const sharp = (await import("sharp")).default;
    await db.update(organizations).set({ logo: await sharp({ create: { width: 200, height: 200, channels: 4, background: "#3366cc" } }).png().toBuffer() }).where(eq(organizations.id, s.orgId));
    const start = { facilityId: s.facilities.cedarRidge, residentFirstName: "Rosa", residentLastName: "Diaz", poaName: "Maria Diaz", poaEmail: "maria@example.com" };
    expect((await inOrg((tx) => startOnboarding(tx, caregiver, s.orgId, start, "https://app.test", now))).ok).toBe(false);
    const r = await inOrg((tx) => startOnboarding(tx, owner, s.orgId, start, "https://app.test", now));
    expect(r.ok).toBe(true);
    packetId = r.ok ? r.data!.id : "";
    const forms = await inOrg((tx) => listForms(tx, owner));
    expect(forms.map((f) => f.title)).toContain("Residential Care Home Agreement");
    // Editing a form later doesn't change what this family was sent.
    const photo = forms.find((f) => f.title === "Photo and media consent")!;
    expect((await inOrg((tx) => saveForm(tx, owner, photo.id, { ...photo, title: "Photo consent (2027)" }))).ok).toBe(true);
    const o = await inOrg((tx) => getOnboarding(tx, owner, packetId));
    expect(o!.items.map((i) => i.title)).toContain("Photo and media consent");
    // Sent forms carry the home's details; the answers show in the wording once given.
    const agreement = o!.items.find((i) => i.title === "Residential Care Home Agreement")!;
    const opening = agreement.blocks.find((b) => b.type === "text" && b.text.startsWith("THIS RESIDENCY AGREEMENT"));
    expect(opening?.type === "text" && opening.text).toContain("located at 3915 Tidewater Dr, Houston, TX 77045");
    expect(opening?.type === "text" && opening.text).toContain("Maria Diaz on behalf of Rosa Diaz");
    const fee = agreement.blocks.find((b) => b.type === "text" && b.text.startsWith("2.) Initial Monthly Fee"))!;
    const feeField = agreement.blocks.find((b) => b.type === "field" && b.label === "Monthly fee")!;
    expect(fee.type === "text" && withAnswers(fee.text, agreement.blocks, {})).toContain("is __________ for each month");
    expect(fee.type === "text" && withAnswers(fee.text, agreement.blocks, { [feeField.id]: "$2,500.00" })).toContain("is $2,500.00 for each month");
    expect(o!.head.address).toBe("3915 Tidewater Dr, Houston, TX 77045");
    const mail = await lastMailTo("maria@example.com");
    expect(mail.subject).toContain("move-in paperwork for Rosa");
    token = tokenIn(mail.body);
  });
});

describe("the family's link", () => {
  it("needs the emailed code, and gives up after too many wrong ones", async () => {
    expect(await packetByToken(db, "not-a-real-token-at-all-xxxx", now)).toBeNull();
    const p = (await packetByToken(db, token, now))!;
    expect(p.id).toBe(packetId);
    await withTenant(db, p.orgId, (tx) => sendCode(tx, p, now));
    const code = /code[^\d]*(\d{6})/.exec((await lastMailTo("maria@example.com")).body)![1];
    for (let i = 0; i < 5; i++) await withTenant(db, p.orgId, (tx) => verifyCode(tx, p, "000000" === code ? "111111" : "000000", now));
    expect((await withTenant(db, p.orgId, (tx) => verifyCode(tx, p, code, now))).ok).toBe(false); // locked out
    await withTenant(db, p.orgId, (tx) => sendCode(tx, p, now));
    const fresh = /code[^\d]*(\d{6})/.exec((await lastMailTo("maria@example.com")).body)![1];
    const v = await withTenant(db, p.orgId, (tx) => verifyCode(tx, p, fresh, now));
    expect(v.ok).toBe(true);
    expect(await withTenant(db, p.orgId, (tx) => familySession(tx, p, v.ok ? v.data!.session : "", now))).toBe(true);
    expect(await withTenant(db, p.orgId, (tx) => familySession(tx, p, "someone-else", now))).toBe(false);
  });

  it("lets the family fill, sign and send each item; changing an answer voids the signature", async () => {
    const p = (await packetByToken(db, token, now))!;
    const view = await withTenant(db, p.orgId, (tx) => familyView(tx, p));
    for (const item of view.items) {
      if (item.kind === "upload") {
        expect((await withTenant(db, p.orgId, (tx) => familySubmit(tx, p, item.id, now))).ok).toBe(false);
        expect((await withTenant(db, p.orgId, (tx) => familyUpload(tx, p, item.id, { name: "scan.pdf", data: pdf }, now))).ok).toBe(true);
      } else {
        const answers: Record<string, string> = {};
        for (const b of item.blocks) {
          if (b.type !== "field" || b.who !== "poa") continue;
          answers[b.id] = b.input === "date" ? "1950-04-02" : b.input === "yesno" || b.input === "check" ? "yes" : b.input === "choice" ? b.options![0] : b.label.startsWith("Allergies") ? "Penicillin" : "Answer";
        }
        // Staff-only fields can't be filled by the family.
        const staffField = item.blocks.find((b) => b.type === "field" && b.who === "staff");
        if (staffField) answers[staffField.id] = "family tried";
        expect((await withTenant(db, p.orgId, (tx) => familySaveValues(tx, p, item.id, answers, now))).ok).toBe(true);
        for (const b of item.blocks) if (b.type === "signature" && b.who === "poa") expect((await withTenant(db, p.orgId, (tx) => familySign(tx, p, item.id, b.id, typed("Maria Diaz"), { ip: "203.0.113.9" }, now))).ok).toBe(true);
        // Staff lines aren't the family's to sign.
        const staffLine = item.blocks.find((b) => b.type === "signature" && b.who === "staff");
        if (staffLine) expect((await withTenant(db, p.orgId, (tx) => familySign(tx, p, item.id, staffLine.id, typed("Maria Diaz"), {}, now))).ok).toBe(false);
      }
      const r = await withTenant(db, p.orgId, (tx) => familySubmit(tx, p, item.id, now));
      expect(r.ok, `${item.title}: ${r.ok ? "" : r.error}`).toBe(true);
    }
    const after = await withTenant(db, p.orgId, (tx) => familyView(tx, p));
    expect(after.items.every((i) => i.status === "submitted")).toBe(true);
    const staffValue = after.items.flatMap((i) => i.blocks.filter((b) => b.type === "field" && b.who === "staff").map((b) => i.values[b.id]));
    expect(staffValue.every((v) => v === undefined)).toBe(true);
    // Changing an answer after signing voids the signature and the form goes back to "to do".
    const consent = after.items.find((i) => i.title === "Photo and media consent")!;
    const yesno = consent.blocks.find((b) => b.type === "field" && b.input === "yesno")!;
    const changed = await withTenant(db, p.orgId, (tx) => familySaveValues(tx, p, consent.id, { ...consent.values, [yesno.id]: "no" }, now));
    expect(changed.ok && changed.message).toMatch(/signed again/);
    const again = (await withTenant(db, p.orgId, (tx) => familyView(tx, p))).items.find((i) => i.id === consent.id)!;
    expect(again.status).toBe("todo");
    expect(Object.keys(again.signatures)).toEqual([]);
    const sigLine = again.blocks.find((b) => b.type === "signature")!;
    await withTenant(db, p.orgId, (tx) => familySign(tx, p, consent.id, sigLine.id, typed("Maria Diaz"), {}, now));
    expect((await withTenant(db, p.orgId, (tx) => familySubmit(tx, p, consent.id, now))).ok).toBe(true);
    const voided = await db.select().from(onboardingSignatures).where(eq(onboardingSignatures.itemId, consent.id));
    expect(voided.filter((x) => x.voidedAt).length).toBe(1);
  });
});

describe("review and admission", () => {
  it("staff complete their part, approve, and admit: the resident and signed PDFs are created", async () => {
    let o = (await inOrg((tx) => getOnboarding(tx, owner, packetId)))!;
    // Can't admit before everything is approved.
    expect((await inOrg((tx) => admitOnboarding(tx, owner, packetId, { firstName: "Rosa", lastName: "Diaz" }, renderOnboardingPdf, "https://app.test", now))).ok).toBe(false);
    const agreement = o.items.find((i) => i.title === "Residential Care Home Agreement")!;
    expect((await inOrg((tx) => reviewItem(tx, owner, packetId, agreement.id, "approve", "", now))).ok).toBe(false); // staff part missing
    expect((await inOrg((tx) => reviewItem(tx, owner, packetId, agreement.id, "changes", "", now))).ok).toBe(false); // needs a note
    for (const item of o.items.filter((i) => i.kind === "form")) {
      const staffAnswers: Record<string, string> = {};
      for (const b of item.blocks) if (b.type === "field" && b.who === "staff") staffAnswers[b.id] = b.input === "date" ? "2026-11-15" : b.input === "choice" ? b.options![0] : b.input === "yesno" ? "yes" : /^room/i.test(b.label) ? "104" : "$3,200.00";
      if (Object.keys(staffAnswers).length) {
        // Staff answers change the form, so the family's signature on it is voided...
        const r = await inOrg((tx) => staffSaveValues(tx, owner, packetId, item.id, staffAnswers, now));
        expect(r.ok).toBe(true);
      }
    }
    o = (await inOrg((tx) => getOnboarding(tx, owner, packetId)))!;
    const voidedForms = o.items.filter((i) => i.kind === "form" && i.poaMissing.length);
    expect(voidedForms.map((i) => i.title)).toEqual(expect.arrayContaining(["Residential Care Home Agreement"]));
    // ...so the home sends those back, and the family signs again.
    const p = (await packetByToken(db, token, now))!;
    for (const item of voidedForms) {
      await inOrg((tx) => reviewItem(tx, owner, packetId, item.id, "changes", "We added the rate and move-in date. Please check and sign again.", now));
      for (const b of item.blocks) if (b.type === "signature" && b.who === "poa") await withTenant(db, p.orgId, (tx) => familySign(tx, p, item.id, b.id, typed("Maria Diaz"), {}, now));
      expect((await withTenant(db, p.orgId, (tx) => familySubmit(tx, p, item.id, now))).ok).toBe(true);
    }
    o = (await inOrg((tx) => getOnboarding(tx, owner, packetId)))!;
    for (const item of o.items) {
      for (const b of item.blocks) if (b.type === "signature" && b.who === "staff") expect((await inOrg((tx) => staffSign(tx, owner, packetId, item.id, b.id, typed("Joy Owner"), { ip: "198.51.100.4" }, now))).ok).toBe(true);
      const r = await inOrg((tx) => reviewItem(tx, owner, packetId, item.id, "approve", "", now));
      expect(r.ok, `${item.title}: ${r.ok ? "" : r.error}`).toBe(true);
    }
    const admitted = await inOrg((tx) => admitOnboarding(tx, owner, packetId, { firstName: "Rosa", lastName: "Diaz", dateOfBirth: "1950-04-02", room: "104", allergies: "Penicillin" }, renderOnboardingPdf, "https://app.test", now));
    expect(admitted.ok, admitted.ok ? "" : admitted.error).toBe(true);
    const residentId = admitted.ok ? admitted.data!.residentId : "";
    const [r] = await db.select().from(residents).where(eq(residents.id, residentId));
    expect([r.firstName, r.room, r.allergies]).toEqual(["Rosa", "104", ["Penicillin"]]);
    const docs = await inOrg((tx) => listDocuments(tx, owner, residentId));
    expect(docs.length).toBe(o.items.length);
    const agreementPdf = (await db.select().from(residentDocuments).where(eq(residentDocuments.title, "Residential Care Home Agreement (signed)")))[0];
    expect(agreementPdf.data.subarray(0, 5).toString()).toBe("%PDF-");
    // The family gets a new link to download their copies; the old one stops working.
    expect(await packetByToken(db, token, now)).toBeNull();
    const mail = await lastMailTo("maria@example.com");
    expect(mail.subject).toContain("signed move-in paperwork");
    const p2 = (await packetByToken(db, tokenIn(mail.body), now))!;
    const view = await withTenant(db, p2.orgId, (tx) => familyView(tx, p2));
    expect(view.documents.length).toBe(docs.length);
    expect((await withTenant(db, p2.orgId, (tx) => familyDocument(tx, p2, view.documents[0].id)))?.data.length).toBeGreaterThan(0);
  });
});
