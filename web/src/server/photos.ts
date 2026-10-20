import { eq } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { residentPhotos, residents } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import { getResident, residentName, type Result } from "./residents";

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
const SIZE = 480;

/** JPEG, PNG, WebP or HEIC/HEIF (iPad and iPhone cameras), judged by the file's own bytes, not its name. */
function looksLikeImage(b: Buffer): boolean {
  if (b.length < 12) return false;
  const jpeg = b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP";
  const heic = b.subarray(4, 8).toString("ascii") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(b.subarray(8, 12).toString("ascii"));
  return jpeg || png || webp || heic;
}

/**
 * Turns an uploaded picture into a small, square JPEG: turned upright, cropped to the centre,
 * and re-encoded so nothing from the original file survives (no location or camera metadata).
 */
export async function normalisePhoto(input: Buffer): Promise<Buffer | null> {
  if (!looksLikeImage(input)) return null;
  const sharp = (await import("sharp")).default;
  try {
    return await sharp(input, { limitInputPixels: 50_000_000 }).rotate().resize(SIZE, SIZE, { fit: "cover", position: "attention" }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

/** Owners and admins add or replace a resident's photo. */
export async function setResidentPhoto(tx: Tx, actor: Actor, residentId: string, upload: Buffer): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can change resident photos." };
  const r = await getResident(tx, actor, residentId);
  if (!r) return { ok: false, error: "That resident isn't available." };
  if (upload.length > MAX_UPLOAD_BYTES) return { ok: false, error: "That photo is too large. Use one under 8 MB." };
  const data = await normalisePhoto(upload);
  if (!data) return { ok: false, error: "That file isn't a photo we can use. Use a JPEG, PNG, WebP or iPad/iPhone photo." };
  const now = new Date();
  await tx
    .insert(residentPhotos)
    .values({ residentId: r.id, orgId: r.orgId, data, contentType: "image/jpeg", updatedBy: actor.id, updatedAt: now })
    .onConflictDoUpdate({ target: residentPhotos.residentId, set: { data, contentType: "image/jpeg", updatedBy: actor.id, updatedAt: now } });
  await tx.update(residents).set({ photoUpdatedAt: now }).where(eq(residents.id, r.id));
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: r.photoUpdatedAt ? "resident_photo_replaced" : "resident_photo_added", entity: "resident", entityId: r.id });
  return { ok: true, message: `Photo saved for ${residentName(r)}.` };
}

export async function removeResidentPhoto(tx: Tx, actor: Actor, residentId: string): Promise<Result> {
  if (!canManageCare(actor)) return { ok: false, error: "Only owners and admins can change resident photos." };
  const r = await getResident(tx, actor, residentId);
  if (!r || !r.photoUpdatedAt) return { ok: false, error: "There's no photo to remove." };
  await tx.delete(residentPhotos).where(eq(residentPhotos.residentId, r.id));
  await tx.update(residents).set({ photoUpdatedAt: null }).where(eq(residents.id, r.id));
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "resident_photo_removed", entity: "resident", entityId: r.id });
  return { ok: true, message: "Photo removed." };
}

/** The photo bytes, for anyone who can see the resident (caregivers included). */
export async function getResidentPhoto(tx: Tx, actor: Actor, residentId: string): Promise<{ data: Buffer; contentType: string } | null> {
  const r = await getResident(tx, actor, residentId);
  if (!r) return null;
  const [p] = await tx.select().from(residentPhotos).where(eq(residentPhotos.residentId, r.id));
  return p ? { data: p.data, contentType: p.contentType } : null;
}
