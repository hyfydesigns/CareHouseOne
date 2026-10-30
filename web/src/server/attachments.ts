import { asc, count, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { noteAttachments, progressNotes } from "@/db/schema";
import { canManageCare, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import { getResident, type Result } from "./residents";
import { notOnShift } from "./shift-guard";

/** Each upload is one request, kept under the 10 MB the app accepts per request. */
export const MAX_ATTACHMENT_BYTES = 9 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_NOTE = 6;
/** Who wrote a note can add to it for a day; owners and admins any time. */
const AUTHOR_WINDOW_HOURS = 24;
/** Photos are scaled to fit this many pixels on the long side: plenty to read a document. */
const MAX_IMAGE_SIDE = 2400;

type Kind = "jpeg" | "png" | "webp" | "heic" | "pdf";

function sniff(b: Buffer): Kind | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "webp";
  if (b.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|mif1|hevc)/.test(b.subarray(8, 12).toString("latin1"))) return "heic";
  if (b.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  return null;
}

/**
 * Checks what the file really is (not what it claims to be). Photos are turned upright, scaled
 * down and re-saved as JPEG, which drops everything the camera recorded (GPS location, device).
 * PDFs are kept as they are.
 */
export async function normaliseAttachment(input: Buffer, name: string): Promise<{ data: Buffer; contentType: string; filename: string } | { error: string }> {
  const kind = sniff(input);
  if (!kind) return { error: `${name} isn't a photo or a PDF.` };
  const base = (name.replace(/\.[^.]+$/, "").replace(/[^\w .()-]+/g, "").trim() || "attachment").slice(0, 80);
  if (kind === "pdf") return { data: input, contentType: "application/pdf", filename: `${base}.pdf` };
  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(input, { limitInputPixels: 80_000_000 }).rotate().resize(MAX_IMAGE_SIDE, MAX_IMAGE_SIDE, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    return { data, contentType: "image/jpeg", filename: `${base}.jpg` };
  } catch {
    return { error: kind === "heic" ? `${name} is in a format this server can't read. Take the photo again in the app, or save it as JPEG.` : `${name} couldn't be read as a photo.` };
  }
}

/** Adds one photo or PDF to a progress note. */
export async function addAttachment(tx: Tx, actor: Actor, noteId: string, upload: { name: string; data: Buffer }, now = new Date()): Promise<Result<{ id: string }>> {
  if (!/^[0-9a-f-]{36}$/i.test(noteId)) return { ok: false, error: "That note isn't available." };
  const [note] = await tx.select().from(progressNotes).where(eq(progressNotes.id, noteId));
  if (!note) return { ok: false, error: "That note isn't available." };
  const r = await getResident(tx, actor, note.residentId);
  if (!r) return { ok: false, error: "That note isn't available." };
  const ownRecent = note.recordedBy === actor.id && now.getTime() - note.recordedAt.getTime() < AUTHOR_WINDOW_HOURS * 3_600_000;
  if (!ownRecent && !canManageCare(actor)) return { ok: false, error: "Only the person who wrote the note (within a day) or an owner or admin can attach files to it." };
  const blocked = await notOnShift(tx, actor, { residentId: r.id });
  if (blocked) return { ok: false, error: blocked };
  if (upload.data.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${upload.name} is too large. Use files under 9 MB.` };
  const [{ n }] = await tx.select({ n: count() }).from(noteAttachments).where(eq(noteAttachments.noteId, note.id));
  if (n >= MAX_ATTACHMENTS_PER_NOTE) return { ok: false, error: `A note can have up to ${MAX_ATTACHMENTS_PER_NOTE} attachments.` };
  const file = await normaliseAttachment(upload.data, upload.name);
  if ("error" in file) return { ok: false, error: file.error };
  const [row] = await tx
    .insert(noteAttachments)
    .values({ orgId: r.orgId, noteId: note.id, residentId: r.id, filename: file.filename, contentType: file.contentType, sizeBytes: file.data.length, data: file.data, uploadedBy: actor.id, uploadedAt: now })
    .returning({ id: noteAttachments.id });
  await audit(tx, { orgId: r.orgId, actorId: actor.id, action: "note_attachment_added", entity: "resident", entityId: r.id, details: { noteId: note.id, attachmentId: row.id, type: file.contentType } });
  return { ok: true, message: `${file.filename} attached.`, data: { id: row.id } };
}

export interface AttachmentInfo {
  id: string;
  noteId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}

/** The attachments of some notes (no file contents), grouped by note. */
export async function attachmentsFor(tx: Tx, noteIds: string[]): Promise<Map<string, AttachmentInfo[]>> {
  const out = new Map<string, AttachmentInfo[]>();
  if (!noteIds.length) return out;
  const rows = await tx
    .select({ id: noteAttachments.id, noteId: noteAttachments.noteId, filename: noteAttachments.filename, contentType: noteAttachments.contentType, sizeBytes: noteAttachments.sizeBytes })
    .from(noteAttachments)
    .where(inArray(noteAttachments.noteId, noteIds))
    .orderBy(asc(noteAttachments.uploadedAt));
  for (const r of rows) out.set(r.noteId, [...(out.get(r.noteId) ?? []), r]);
  return out;
}

/** One attachment's file, for anyone who can see the resident. */
export async function getAttachment(tx: Tx, actor: Actor, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [a] = await tx.select().from(noteAttachments).where(eq(noteAttachments.id, id));
  if (!a) return null;
  const r = await getResident(tx, actor, a.residentId);
  return r ? a : null;
}

export const attachmentUrl = (a: Pick<AttachmentInfo, "id">) => `/api/attachments/${a.id}`;
