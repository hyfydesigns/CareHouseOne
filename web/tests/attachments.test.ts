import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { noteAttachments } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { addAttachment, attachmentsFor, getAttachment, MAX_ATTACHMENTS_PER_NOTE, normaliseAttachment } from "@/server/attachments";
import { addNote, signInShift } from "@/server/care";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let owner: Actor;
let caregiver: Actor;
let maple: Actor;
let noteId: string;
const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2]) => withTenant(db, s.orgId, fn);
const now = new Date("2026-10-29T14:00:00Z");

/** A real JPEG with EXIF (including a GPS position) like a phone camera writes. */
async function cameraPhoto(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 3000, height: 2000, channels: 3, background: "#cfc8b8" } })
    .withExif({ IFD0: { Make: "TabletCo", Model: "Home Tablet" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "32/1 46/1 0/1" } })
    .jpeg()
    .toBuffer();
}
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n");

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge] };
  maple = { id: s.users.nurse.id, role: "caregiver", facilityIds: [s.facilities.mapleHouse] };
  await inOrg((tx) => signInShift(tx, caregiver, s.orgId, [s.facilities.cedarRidge], null, now));
  const r = await inOrg((tx) => addNote(tx, caregiver, { residentId: c.residents.lena.id, shift: "day", category: "health", body: "Scanned the clinic's discharge sheet." }, now));
  if (!r.ok) throw new Error(r.error);
  noteId = r.data!.id;
});

describe("progress note attachments", () => {
  it("re-encodes photos smaller with the camera's details (GPS) removed, and keeps PDFs", async () => {
    const photo = await normaliseAttachment(await cameraPhoto(), "IMG_0042.HEIC.jpeg");
    if ("error" in photo) throw new Error(photo.error);
    expect(photo.contentType).toBe("image/jpeg");
    const sharp = (await import("sharp")).default;
    const meta = await sharp(photo.data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(2400);
    expect(meta.exif).toBeUndefined();
    const doc = await normaliseAttachment(pdf, "discharge sheet.pdf");
    expect(!("error" in doc) && doc.contentType).toBe("application/pdf");
    const bad = await normaliseAttachment(Buffer.from("<html><script>alert(1)</script></html>"), "fake.jpg");
    expect("error" in bad && bad.error).toMatch(/isn't a photo or a PDF/);
  });

  it("lets the note's author (on shift) attach files, up to the limit", async () => {
    const r = await inOrg(async (tx) => addAttachment(tx, caregiver, noteId, { name: "sheet.jpg", data: await cameraPhoto() }, now));
    expect(r.ok).toBe(true);
    expect((await inOrg((tx) => addAttachment(tx, caregiver, noteId, { name: "sheet.pdf", data: pdf }, now))).ok).toBe(true);
    const listed = await inOrg((tx) => attachmentsFor(tx, [noteId]));
    expect(listed.get(noteId)?.map((a) => a.contentType)).toEqual(["image/jpeg", "application/pdf"]);
    for (let i = 2; i < MAX_ATTACHMENTS_PER_NOTE; i++) await inOrg((tx) => addAttachment(tx, caregiver, noteId, { name: `p${i}.pdf`, data: pdf }, now));
    const over = await inOrg((tx) => addAttachment(tx, caregiver, noteId, { name: "one-more.pdf", data: pdf }, now));
    expect(!over.ok && over.error).toMatch(/up to 6/);
    // Permanent, like the note.
    await expect(inOrg((tx) => tx.delete(noteAttachments).where(eq(noteAttachments.noteId, noteId)))).rejects.toThrow();
  });

  it("refuses other people's notes (except owners), other homes, and old notes", async () => {
    const r = await inOrg((tx) => addNote(tx, owner, { residentId: c.residents.lena.id, shift: "day", category: "general", body: "Owner note." }, now));
    const ownerNote = r.ok ? r.data!.id : "";
    const notMine = await inOrg((tx) => addAttachment(tx, caregiver, ownerNote, { name: "x.pdf", data: pdf }, now));
    expect(!notMine.ok && notMine.error).toMatch(/person who wrote the note/);
    expect((await inOrg((tx) => addAttachment(tx, owner, ownerNote, { name: "x.pdf", data: pdf }, now))).ok).toBe(true);
    // A day later, the author can't add any more; the owner still can.
    const fresh = await inOrg((tx) => addNote(tx, caregiver, { residentId: c.residents.lena.id, shift: "day", category: "general", body: "Second note." }, now));
    const freshId = fresh.ok ? fresh.data!.id : "";
    const later = new Date(now.getTime() + 25 * 3_600_000);
    const tooLate = await inOrg((tx) => addAttachment(tx, caregiver, freshId, { name: "late.pdf", data: pdf }, later));
    expect(!tooLate.ok && tooLate.error).toMatch(/within a day/);
    expect((await inOrg((tx) => addAttachment(tx, owner, freshId, { name: "late.pdf", data: pdf }, later))).ok).toBe(true);
    // Someone at Maple House can't see Lena's note at all.
    expect(await inOrg((tx) => getAttachment(tx, maple, (r.ok && r.data!.id) || ""))).toBeNull();
    const [any] = await db.select({ id: noteAttachments.id }).from(noteAttachments).where(eq(noteAttachments.noteId, noteId)).limit(1);
    expect(await inOrg((tx) => getAttachment(tx, maple, any.id))).toBeNull();
    expect((await inOrg((tx) => getAttachment(tx, caregiver, any.id)))?.contentType).toBe("image/jpeg");
  });
});
