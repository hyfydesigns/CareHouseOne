import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { residentDocuments } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { addDocument, getDocument, listDocuments, removeDocument } from "@/server/documents";
import { hasCareRecords } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
});

describe("resident documents", () => {
  it("are added by owners and admins only, with a name and a kind", async () => {
    const lena = c.residents.lena.id;
    expect((await inOrg((tx) => addDocument(tx, caregiver, lena, { name: "a.pdf", data: pdf, title: "Agreement", category: "admission" }))).ok).toBe(false);
    expect((await inOrg((tx) => addDocument(tx, owner, lena, { name: "a.pdf", data: pdf, title: "", category: "admission" }))).ok).toBe(false);
    expect((await inOrg((tx) => addDocument(tx, owner, lena, { name: "a.pdf", data: pdf, title: "Agreement", category: "junk" }))).ok).toBe(false);
    expect((await inOrg((tx) => addDocument(tx, owner, lena, { name: "a.jpg", data: Buffer.from("<html></html>"), title: "Agreement", category: "admission" }))).ok).toBe(false);
    const r = await inOrg((tx) => addDocument(tx, owner, lena, { name: "agreement.pdf", data: pdf, title: "Admission agreement", category: "admission" }));
    expect(r.ok).toBe(true);
    const list = await inOrg((tx) => listDocuments(tx, owner, lena));
    expect(list.map((d) => [d.title, d.category, d.contentType])).toEqual([["Admission agreement", "admission", "application/pdf"]]);
    expect(await inOrg((tx) => listDocuments(tx, caregiver, lena))).toEqual([]);
    expect(await inOrg((tx) => getDocument(tx, caregiver, r.data!.id))).toBeNull();
    // A resident with a document on file isn't one "added by mistake" any more.
    expect(await inOrg((tx) => hasCareRecords(tx, lena))).toBe(true);
  });

  it("are removed with a reason, never deleted", async () => {
    const lena = c.residents.lena.id;
    const [d] = await inOrg((tx) => listDocuments(tx, owner, lena));
    expect((await inOrg((tx) => removeDocument(tx, owner, d.id, ""))).ok).toBe(false);
    expect((await inOrg((tx) => removeDocument(tx, owner, d.id, "Wrong resident"))).ok).toBe(true);
    expect(await inOrg((tx) => listDocuments(tx, owner, lena))).toEqual([]);
    expect(await inOrg((tx) => getDocument(tx, owner, d.id))).toBeNull();
    const [kept] = await inOrg((tx) => tx.select().from(residentDocuments).where(eq(residentDocuments.id, d.id)));
    expect(kept.removedReason).toBe("Wrong resident");
    await expect(inOrg((tx) => tx.delete(residentDocuments).where(eq(residentDocuments.id, d.id)))).rejects.toThrow();
  });
});
