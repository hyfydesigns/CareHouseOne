import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestDb, withTenant, type DB } from "@/db/client";
import { auditLog, residentPhotos } from "@/db/schema";
import type { Actor } from "@/lib/permissions";
import { getResidentPhoto, normalisePhoto, removeResidentPhoto, setResidentPhoto } from "@/server/photos";
import { getResident } from "@/server/residents";
import { seedCare, seedDemo, type Seeded, type SeededCare } from "@/server/seed";

let db: DB;
let s: Seeded;
let c: SeededCare;
let other: Seeded;
let owner: Actor;
let caregiver: Actor;
let camera: Buffer;

beforeAll(async () => {
  db = await createTestDb();
  s = await seedDemo(db);
  c = await seedCare(db, s);
  other = await seedDemo(db, { orgName: "Other Org", emailDomain: "other.test" });
  owner = { id: s.users.owner.id, role: "owner", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  caregiver = { id: s.users.caregiver.id, role: "med_caregiver", facilityIds: [s.facilities.cedarRidge, s.facilities.mapleHouse] };
  // A landscape "camera" JPEG carrying location metadata, like a phone photo.
  camera = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 150, b: 120 } } })
    .jpeg()
    .withExifMerge({ IFD0: { Make: "TestCam", ImageDescription: "Lena at Cedar Ridge" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "40/1 42/1 46/1" } })
    .toBuffer();
});

const inOrg = <T>(fn: Parameters<typeof withTenant<T>>[2], orgId = s.orgId) => withTenant(db, orgId, fn);

describe("resident photos", () => {
  it("stores a small square JPEG with the camera's metadata stripped", async () => {
    const before = await sharp(camera).metadata();
    expect(before.exif).toBeTruthy();
    const r = await inOrg((tx) => setResidentPhoto(tx, owner, c.residents.lena.id, camera));
    expect(r.ok).toBe(true);
    const [row] = await db.select().from(residentPhotos).where(eq(residentPhotos.residentId, c.residents.lena.id));
    const meta = await sharp(row.data).metadata();
    expect(meta).toMatchObject({ format: "jpeg", width: 480, height: 480 });
    expect(meta.exif).toBeUndefined();
    expect(row.data.includes(Buffer.from("TestCam"))).toBe(false);
    expect((await inOrg((tx) => getResident(tx, owner, c.residents.lena.id)))?.photoUpdatedAt).not.toBeNull();
    const [log] = await db.select().from(auditLog).where(and(eq(auditLog.action, "resident_photo_added"), eq(auditLog.entityId, c.residents.lena.id)));
    expect(log).toBeTruthy();
  });

  it("refuses files that aren't images", async () => {
    expect(await normalisePhoto(Buffer.from("%PDF-1.7 not a photo at all"))).toBeNull();
    const r = await inOrg((tx) => setResidentPhoto(tx, owner, c.residents.lena.id, Buffer.from("<svg onload=alert(1)></svg>")));
    expect(!r.ok && r.error).toMatch(/isn't a photo/);
  });

  it("lets caregivers see the photo but not change it", async () => {
    const photo = await inOrg((tx) => getResidentPhoto(tx, caregiver, c.residents.lena.id));
    expect(photo?.contentType).toBe("image/jpeg");
    const r = await inOrg((tx) => setResidentPhoto(tx, caregiver, c.residents.lena.id, camera));
    expect(!r.ok && r.error).toMatch(/owners and admins/);
  });

  it("is invisible to other organizations", async () => {
    const outsider: Actor = { id: other.users.owner.id, role: "owner", facilityIds: [other.facilities.cedarRidge] };
    expect(await inOrg((tx) => getResidentPhoto(tx, outsider, c.residents.lena.id), other.orgId)).toBeNull();
    expect(await inOrg((tx) => tx.select().from(residentPhotos), other.orgId)).toEqual([]);
  });

  it("replaces and removes", async () => {
    const square = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#336699" } }).png().toBuffer();
    expect((await inOrg((tx) => setResidentPhoto(tx, owner, c.residents.lena.id, square))).ok).toBe(true);
    expect(await db.select().from(residentPhotos).where(eq(residentPhotos.residentId, c.residents.lena.id))).toHaveLength(1);
    expect((await inOrg((tx) => removeResidentPhoto(tx, owner, c.residents.lena.id))).ok).toBe(true);
    expect(await inOrg((tx) => getResidentPhoto(tx, owner, c.residents.lena.id))).toBeNull();
    expect((await inOrg((tx) => getResident(tx, owner, c.residents.lena.id)))?.photoUpdatedAt).toBeNull();
  });
});
