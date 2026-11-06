import { and, asc, desc, eq, gt, inArray, isNull, like } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { z } from "zod";
import type { DB, Tx } from "@/db/client";
import { facilities, onboardingAccess, onboardingFiles, onboardingItems, onboardingPackets, onboardingSignatures, organizations, outbox, residentDocuments, users } from "@/db/schema";
import { randomToken, safeEqual, sha256 } from "@/lib/crypto";
import { addressLine, contactLine } from "@/lib/home-contact";
import { blockSchema, changedAnswers, changedSignatures, fillPlaceholders, mergeAnswers, missingFor, partOf, signedPart, type Block, type Values, type Who } from "@/lib/onboarding-forms";
import { canSeeFacility, type Actor } from "@/lib/permissions";
import { MAX_ATTACHMENT_BYTES, normaliseAttachment } from "./attachments";
import { audit, sendMail } from "./audit";
import { canManageOnboarding, ensureStarterForms, listForms } from "./onboarding-forms";
import { createResident, type Result } from "./residents";

export const LINK_DAYS = 30;
/** After admission the family can download the signed copies for this long. */
export const DOWNLOAD_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;
const CODES_PER_HOUR = 5;
export const SESSION_HOURS = 2;
const MAX_FILES_PER_ITEM = 10;

export const E_SIGN_CONSENT =
  "I agree to sign electronically. My electronic signature means the same as my handwritten signature, and I can ask the home for a paper copy of anything I sign.";

export const ITEM_STATUS = { todo: "To do", submitted: "Sent for review", changes: "Changes requested", approved: "Approved" } as const;
export type ItemStatus = keyof typeof ITEM_STATUS;

type Packet = typeof onboardingPackets.$inferSelect;
type ItemRow = typeof onboardingItems.$inferSelect;

const blocksOf = (i: Pick<ItemRow, "blocks">): Block[] =>
  (i.blocks ?? []).flatMap((b) => {
    const p = blockSchema.safeParse(b);
    return p.success ? [p.data as Block] : [];
  });

/** The fingerprint a signature covers: the wording of its part of the form and the answers shown there. */
export const signatureHash = (i: Pick<ItemRow, "title" | "blocks" | "values">, blockId: string) => sha256(signedPart(i.title, blocksOf(i), i.values ?? {}, blockId) ?? "");

// ---------------------------------------------------------------- staff: start and manage

const startSchema = z.object({
  facilityId: z.string().uuid("Choose the home."),
  residentFirstName: z.string().trim().min(1, "Enter the resident's first name.").max(80),
  residentLastName: z.string().trim().min(1, "Enter the resident's last name.").max(80),
  poaName: z.string().trim().min(2, "Enter the responsible party's name.").max(160),
  poaEmail: z.string().trim().toLowerCase().email("Enter the responsible party's email like name@example.com."),
  /** The forms this resident needs; all of them when not given. */
  formIds: z.array(z.string()).optional(),
  /** Saved without sending, so the home can fill in its part (fees, room) before the family sees it. */
  draft: z.boolean().optional(),
});

async function emailLink(tx: Tx, p: Packet, token: string, appUrl: string, kind: "invite" | "reminder") {
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, p.orgId));
  const [home] = await tx.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, p.facilityId));
  await sendMail(tx, {
    orgId: p.orgId,
    to: p.poaEmail,
    subject: `${org.name}: move-in paperwork for ${p.residentFirstName}`,
    body: [
      `Hi ${p.poaName},`,
      "",
      kind === "invite"
        ? `${org.name} (${home.name}) has asked you to complete the move-in paperwork for ${p.residentFirstName}. You can fill in the forms, upload documents and sign online, from a phone or a computer.`
        : `Here is a new link to the move-in paperwork for ${p.residentFirstName} at ${home.name}. The earlier link no longer works.`,
      "",
      `${appUrl}/family/${token}`,
      "",
      `When you open the link, we'll email you a 6-digit code to confirm it's you. The link works until ${p.expiresAt.toISOString().slice(0, 10)}.`,
      "",
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  });
}

/**
 * Owners and admins start an onboarding: the chosen forms are copied into a checklist. The family
 * gets the link straight away, or, for a draft, once the home has filled in its part and sends it.
 */
export async function startOnboarding(tx: Tx, actor: Actor, orgId: string, raw: unknown, appUrl: string, now = new Date()): Promise<Result<{ id: string }>> {
  if (!canManageOnboarding(actor)) return { ok: false, error: "Only owners and admins start onboardings." };
  const p = startSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (!canSeeFacility(actor, p.data.facilityId)) return { ok: false, error: "Choose one of your homes." };
  await ensureStarterForms(tx, orgId, actor.id);
  const all = await listForms(tx, actor);
  if (!all.length) return { ok: false, error: "There are no onboarding forms to send. Add or show some under Onboarding forms." };
  const chosen = p.data.formIds && new Set(p.data.formIds);
  const forms = chosen ? all.filter((f) => chosen.has(f.id)) : all;
  if (!forms.length) return { ok: false, error: "Choose at least one form for this resident." };
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, p.data.facilityId));
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  const ctx = {
    Organization: org.name,
    "Home name": home.name,
    "Home address": addressLine(home),
    "Home phone": home.phone ?? "",
    "Home fax": home.fax ?? "",
    "Home email": home.email ?? "",
    "Resident name": `${p.data.residentFirstName} ${p.data.residentLastName}`,
    "Responsible party": p.data.poaName,
  };
  const { draft, ...rest } = p.data;
  const details = { facilityId: rest.facilityId, residentFirstName: rest.residentFirstName, residentLastName: rest.residentLastName, poaName: rest.poaName, poaEmail: rest.poaEmail };
  // A draft's token is never sent anywhere; sending it makes a new one.
  const token = randomToken();
  const [packet] = await tx
    .insert(onboardingPackets)
    .values({ orgId, ...details, status: draft ? "draft" : "open", tokenHash: sha256(token), expiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000), createdBy: actor.id, createdAt: now })
    .returning();
  await tx.insert(onboardingItems).values(
    forms.map((f, i) => ({ orgId, packetId: packet.id, formId: f.id, formVersion: f.version, title: f.title, description: f.description, kind: f.kind, required: f.required, blocks: fillPlaceholders(f.blocks, ctx), position: i + 1 })),
  );
  if (!draft) await emailLink(tx, packet, token, appUrl, "invite");
  await audit(tx, { orgId, actorId: actor.id, action: "onboarding_started", entity: "organization", entityId: orgId, details: { packetId: packet.id, facilityId: packet.facilityId, forms: forms.length, draft: !!draft } });
  return { ok: true, message: draft ? "Saved. Fill in the home's part, then send the link." : `Sent to ${packet.poaEmail}.`, data: { id: packet.id } };
}

/** Sends a draft onboarding to the family once the home has filled in its part. */
export async function sendOnboarding(tx: Tx, actor: Actor, id: string, appUrl: string, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, id);
  if (!p || p.status !== "draft") return { ok: false, error: "That onboarding was already sent." };
  const token = randomToken();
  const [sent] = await tx.update(onboardingPackets).set({ status: "open", tokenHash: sha256(token), expiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000) }).where(eq(onboardingPackets.id, p.id)).returning();
  await emailLink(tx, sent, token, appUrl, "invite");
  await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_sent", entity: "organization", entityId: p.orgId, details: { packetId: p.id } });
  return { ok: true, message: `Sent to ${p.poaEmail}.` };
}

async function packetFor(tx: Tx, actor: Actor, id: string): Promise<Packet | null> {
  if (!canManageOnboarding(actor) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [p] = await tx.select().from(onboardingPackets).where(eq(onboardingPackets.id, id));
  return p && canSeeFacility(actor, p.facilityId) ? p : null;
}

/** A new link (the old one stops working), for a lost email or an expired link. */
export async function resendLink(tx: Tx, actor: Actor, id: string, appUrl: string, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, id);
  if (!p || p.status !== "open") return { ok: false, error: "That onboarding isn't open." };
  const token = randomToken();
  const [fresh] = await tx.update(onboardingPackets).set({ tokenHash: sha256(token), expiresAt: new Date(now.getTime() + LINK_DAYS * 86_400_000) }).where(eq(onboardingPackets.id, p.id)).returning();
  await tx.update(onboardingAccess).set({ usedAt: now }).where(and(eq(onboardingAccess.packetId, p.id), isNull(onboardingAccess.usedAt)));
  await emailLink(tx, fresh, token, appUrl, "reminder");
  await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_link_resent", entity: "organization", entityId: p.orgId, details: { packetId: p.id } });
  return { ok: true, message: `A new link was sent to ${p.poaEmail}.` };
}

export async function cancelOnboarding(tx: Tx, actor: Actor, id: string, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, id);
  if (!p || (p.status !== "open" && p.status !== "draft")) return { ok: false, error: "That onboarding isn't open." };
  await tx.update(onboardingPackets).set({ status: "cancelled", cancelledAt: now, cancelledBy: actor.id }).where(eq(onboardingPackets.id, p.id));
  await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_cancelled", entity: "organization", entityId: p.orgId, details: { packetId: p.id } });
  return { ok: true, message: "Onboarding cancelled. The family's link no longer works." };
}

/** The demo sends no email: the latest family link from the outbox, so a presenter can open it. */
export async function demoFamilyLink(tx: Tx, p: Packet): Promise<string | null> {
  const [m] = await tx.select({ body: outbox.body }).from(outbox).where(and(eq(outbox.to, p.poaEmail), like(outbox.body, "%/family/%"))).orderBy(desc(outbox.createdAt)).limit(1);
  return m ? (/(\/family\/[A-Za-z0-9_-]+)/.exec(m.body)?.[1] ?? null) : null;
}

/** Every onboarding the person can see, newest first, with how far along it is. */
export async function listOnboardings(tx: Tx, actor: Actor) {
  if (!canManageOnboarding(actor)) return [];
  const packets = (await tx.select({ p: onboardingPackets, home: facilities.name }).from(onboardingPackets).innerJoin(facilities, eq(facilities.id, onboardingPackets.facilityId)).orderBy(desc(onboardingPackets.createdAt))).filter((x) => canSeeFacility(actor, x.p.facilityId));
  if (!packets.length) return [];
  const items = await tx.select({ packetId: onboardingItems.packetId, status: onboardingItems.status, required: onboardingItems.required }).from(onboardingItems).where(inArray(onboardingItems.packetId, packets.map((x) => x.p.id)));
  return packets.map(({ p, home }) => {
    // Every form chosen for this resident; optional ones count too, though admission only waits on the required ones.
    const mine = items.filter((i) => i.packetId === p.id);
    const count = (s: ItemStatus) => mine.filter((i) => i.status === s).length;
    return { p, home, total: mine.length, optional: mine.filter((i) => !i.required).length, approved: count("approved"), submitted: count("submitted"), changes: count("changes") };
  });
}

// ---------------------------------------------------------------- the onboarding as data

export interface ItemView {
  id: string;
  title: string;
  description: string;
  kind: "form" | "upload";
  required: boolean;
  status: ItemStatus;
  staffNote: string | null;
  blocks: Block[];
  values: Values;
  signatures: Record<string, { name: string; image: string | null; signedAt: Date; signer: Who; method: string }>;
  files: Array<{ id: string; filename: string; contentType: string; sizeBytes: number; uploadedAt: Date }>;
  poaMissing: string[];
  staffMissing: string[];
}

async function itemsOf(tx: Tx, packetId: string): Promise<ItemView[]> {
  const items = await tx.select().from(onboardingItems).where(eq(onboardingItems.packetId, packetId)).orderBy(asc(onboardingItems.position));
  const sigs = await tx.select().from(onboardingSignatures).where(and(eq(onboardingSignatures.packetId, packetId), isNull(onboardingSignatures.voidedAt)));
  const files = await tx
    .select({ id: onboardingFiles.id, itemId: onboardingFiles.itemId, filename: onboardingFiles.filename, contentType: onboardingFiles.contentType, sizeBytes: onboardingFiles.sizeBytes, uploadedAt: onboardingFiles.uploadedAt })
    .from(onboardingFiles)
    .where(and(eq(onboardingFiles.packetId, packetId), isNull(onboardingFiles.removedAt)))
    .orderBy(asc(onboardingFiles.uploadedAt));
  return items.map((i) => {
    const blocks = blocksOf(i);
    const mineSigs = sigs.filter((s) => s.itemId === i.id);
    const signed = new Set(mineSigs.map((s) => s.blockId));
    const myFiles = files.filter((f) => f.itemId === i.id);
    const kind = i.kind === "upload" ? "upload" : "form";
    return {
      id: i.id,
      title: i.title,
      description: i.description,
      kind,
      required: i.required,
      status: (i.status in ITEM_STATUS ? i.status : "todo") as ItemStatus,
      staffNote: i.staffNote,
      blocks,
      values: i.values ?? {},
      signatures: Object.fromEntries(mineSigs.map((s) => [s.blockId, { name: s.name, image: s.image ? `data:image/png;base64,${Buffer.from(s.image).toString("base64")}` : null, signedAt: s.signedAt, signer: s.signer as Who, method: s.method }])),
      files: myFiles,
      poaMissing: kind === "upload" ? (myFiles.length ? [] : ["At least one file"]) : missingFor(blocks, i.values ?? {}, signed, "poa"),
      staffMissing: kind === "upload" ? [] : missingFor(blocks, i.values ?? {}, signed, "staff"),
    } satisfies ItemView;
  });
}

/** One onboarding for staff: the packet, the home, and every item with its answers and signatures. */
export async function getOnboarding(tx: Tx, actor: Actor, id: string) {
  const p = await packetFor(tx, actor, id);
  if (!p) return null;
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, p.facilityId));
  return { p, home, head: await letterhead(tx, p), items: await itemsOf(tx, p.id) };
}

// ---------------------------------------------------------------- filling in and signing

type Party = { who: Who; userId: string | null; orgId: string };
type SignInput = { name: unknown; method: unknown; image?: unknown; consent: unknown };
type Meta = { ip?: string; userAgent?: string };

async function editableItem(tx: Tx, packet: Packet, itemId: string): Promise<ItemRow | { error: string }> {
  if (packet.status !== "open" && packet.status !== "draft") return { error: "This onboarding is closed." };
  if (!/^[0-9a-f-]{36}$/i.test(itemId)) return { error: "That form isn't part of this onboarding." };
  const [item] = await tx.select().from(onboardingItems).where(and(eq(onboardingItems.id, itemId), eq(onboardingItems.packetId, packet.id)));
  if (!item) return { error: "That form isn't part of this onboarding." };
  if (item.status === "approved") return { error: "This form was approved and can't be changed. Ask the home if something needs correcting." };
  return item;
}

/** Saves one side's answers. Changing an answer voids the signatures on the parts of the form that show it. */
async function saveValues(tx: Tx, packet: Packet, itemId: string, raw: Record<string, unknown>, party: Party, now: Date): Promise<Result> {
  const item = await editableItem(tx, packet, itemId);
  if ("error" in item) return { ok: false, error: item.error };
  const blocks = blocksOf(item);
  const values = mergeAnswers(blocks, item.values ?? {}, raw, party.who);
  const changed = changedAnswers(item.values ?? {}, values);
  if (!changed.length) return { ok: true, message: "Saved." };
  const signed = await tx.select({ id: onboardingSignatures.id, blockId: onboardingSignatures.blockId }).from(onboardingSignatures).where(and(eq(onboardingSignatures.itemId, item.id), isNull(onboardingSignatures.voidedAt)));
  const lines = changedSignatures(item.title, blocks, item.values ?? {}, values, signed.map((s) => s.blockId));
  const affected = signed.filter((s) => lines.includes(s.blockId)).map((s) => s.id);
  const voided = affected.length ? await tx.update(onboardingSignatures).set({ voidedAt: now }).where(inArray(onboardingSignatures.id, affected)).returning({ id: onboardingSignatures.id }) : [];
  await tx.update(onboardingItems).set({ values, status: party.who === "poa" ? "todo" : item.status, updatedAt: now }).where(eq(onboardingItems.id, item.id));
  // The home answering for the family is on the record: which questions, not what was answered.
  const forFamily = party.who === "staff" ? changed.filter((id) => blocks.some((b) => b.id === id && b.type === "field" && b.who === "poa")) : [];
  if (forFamily.length) await audit(tx, { orgId: packet.orgId, actorId: party.userId, action: "onboarding_answered_for_family", entity: "organization", entityId: packet.orgId, details: { packetId: packet.id, itemId: item.id, fields: forFamily } });
  if (voided.length) await audit(tx, { orgId: packet.orgId, actorId: party.userId, action: "onboarding_signatures_voided", entity: "organization", entityId: packet.orgId, details: { packetId: packet.id, itemId: item.id, count: voided.length, by: party.who } });
  return { ok: true, message: voided.length ? "Saved. The signed part showing that answer needs to be signed again." : "Saved." };
}

const signSchema = z.object({
  name: z.string().trim().min(2, "Type your full name.").max(120),
  method: z.enum(["drawn", "typed"]),
  consent: z.literal(true, { message: "Tick the box to agree to sign electronically." }),
  image: z.string().max(400_000).optional(),
});

/** Records a signature on one signature line, as evidence of exactly what was signed. */
async function sign(tx: Tx, packet: Packet, itemId: string, blockId: string, raw: SignInput, party: Party, meta: Meta, now: Date): Promise<Result> {
  const item = await editableItem(tx, packet, itemId);
  if ("error" in item) return { ok: false, error: item.error };
  const p = signSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const blocks = blocksOf(item);
  const line = blocks.find((b) => b.id === blockId);
  if (!line || line.type !== "signature" || line.who !== party.who) return { ok: false, error: "That signature line isn't yours to sign." };
  // Each part is signed on its own: only this part's questions need answers.
  const fieldsLeft = missingFor(partOf(blocks, blockId).filter((b) => b.type === "field"), item.values ?? {}, new Set(), party.who);
  if (fieldsLeft.length) return { ok: false, error: `Fill in ${fieldsLeft.slice(0, 3).join(", ")}${fieldsLeft.length > 3 ? "…" : ""} above, then sign.` };
  let image: Buffer | null = null;
  if (p.data.method === "drawn") {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(p.data.image ?? "");
    image = m ? Buffer.from(m[1], "base64") : null;
    if (!image || image.length < 100 || !image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { ok: false, error: "Draw your signature in the box, or type it instead." };
  }
  const [existing] = await tx.select({ id: onboardingSignatures.id }).from(onboardingSignatures).where(and(eq(onboardingSignatures.itemId, item.id), eq(onboardingSignatures.blockId, blockId), isNull(onboardingSignatures.voidedAt)));
  if (existing) return { ok: false, error: "This line is already signed." };
  await tx.insert(onboardingSignatures).values({
    orgId: packet.orgId,
    packetId: packet.id,
    itemId: item.id,
    blockId,
    signer: party.who,
    userId: party.userId,
    name: p.data.name,
    method: p.data.method,
    image,
    consent: E_SIGN_CONSENT,
    documentHash: signatureHash(item, blockId),
    ip: meta.ip?.slice(0, 100) ?? null,
    userAgent: meta.userAgent?.slice(0, 300) ?? null,
    signedAt: now,
  });
  await audit(tx, { orgId: packet.orgId, actorId: party.userId, action: "onboarding_signed", entity: "organization", entityId: packet.orgId, details: { packetId: packet.id, itemId: item.id, blockId, signer: party.who, method: p.data.method } });
  return { ok: true, message: "Signed." };
}

// ---------------------------------------------------------------- staff side

export async function staffSaveValues(tx: Tx, actor: Actor, packetId: string, itemId: string, raw: Record<string, unknown>, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, packetId);
  if (!p) return { ok: false, error: "That onboarding isn't available." };
  return saveValues(tx, p, itemId, raw, { who: "staff", userId: actor.id, orgId: p.orgId }, now);
}

export async function staffSign(tx: Tx, actor: Actor, packetId: string, itemId: string, blockId: string, raw: SignInput, meta: Meta, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, packetId);
  if (!p) return { ok: false, error: "That onboarding isn't available." };
  return sign(tx, p, itemId, blockId, raw, { who: "staff", userId: actor.id, orgId: p.orgId }, meta, now);
}

/** Staff check an item: approve it (everything filled and signed) or send it back with a note. */
export async function reviewItem(tx: Tx, actor: Actor, packetId: string, itemId: string, decision: "approve" | "changes", note: unknown, now = new Date()): Promise<Result> {
  const p = await packetFor(tx, actor, packetId);
  if (!p) return { ok: false, error: "That onboarding isn't available." };
  const item = (await itemsOf(tx, p.id)).find((i) => i.id === itemId);
  if (!item || p.status !== "open") return { ok: false, error: "That form isn't open for review." };
  if (decision === "changes") {
    const n = z.string().trim().min(3, "Say what needs changing; the family sees this note.").max(1000).safeParse(note);
    if (!n.success) return { ok: false, error: n.error.issues[0].message };
    await tx.update(onboardingItems).set({ status: "changes", staffNote: n.data, reviewedAt: now, reviewedBy: actor.id }).where(eq(onboardingItems.id, item.id));
    await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_changes_requested", entity: "organization", entityId: p.orgId, details: { packetId: p.id, itemId: item.id } });
    return { ok: true, message: "Sent back to the family with your note." };
  }
  if (item.poaMissing.length) return { ok: false, error: `The family still needs to complete: ${item.poaMissing.slice(0, 3).join(", ")}.` };
  if (item.staffMissing.length) return { ok: false, error: `Complete the home's part first: ${item.staffMissing.slice(0, 3).join(", ")}.` };
  await tx.update(onboardingItems).set({ status: "approved", staffNote: null, reviewedAt: now, reviewedBy: actor.id }).where(eq(onboardingItems.id, item.id));
  await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_item_approved", entity: "organization", entityId: p.orgId, details: { packetId: p.id, itemId: item.id } });
  return { ok: true, message: `${item.title} approved.` };
}

/** A file the family uploaded, for staff to check. */
export async function staffFile(tx: Tx, actor: Actor, fileId: string) {
  if (!canManageOnboarding(actor) || !/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const [f] = await tx.select().from(onboardingFiles).where(eq(onboardingFiles.id, fileId));
  if (!f || f.removedAt || !(await packetFor(tx, actor, f.packetId))) return null;
  return f;
}

// ---------------------------------------------------------------- the family's side

/**
 * The family's link: finds the onboarding from the token alone (before any organization is
 * known), then everything else runs inside that organization. Drafts, cancelled and expired links don't work.
 */
export async function packetByToken(db: DB, token: string, now = new Date()): Promise<Packet | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const [p] = await db.select().from(onboardingPackets).where(and(eq(onboardingPackets.tokenHash, sha256(token)), gt(onboardingPackets.expiresAt, now)));
  return p && (p.status === "open" || p.status === "admitted") ? p : null;
}

const mask = (email: string) => email.replace(/^(.)(.*)(@.*)$/, (_, a: string, b: string, c: string) => `${a}${"•".repeat(Math.min(b.length, 6))}${c}`);

/** Emails the POA a 6-digit code (a few per hour at most). */
export async function sendCode(tx: Tx, packet: Packet, now = new Date()): Promise<Result<{ to: string; code: string }>> {
  const recent = await tx.select({ at: onboardingAccess.createdAt }).from(onboardingAccess).where(and(eq(onboardingAccess.packetId, packet.id), eq(onboardingAccess.kind, "code"), gt(onboardingAccess.createdAt, new Date(now.getTime() - 3_600_000))));
  if (recent.length >= CODES_PER_HOUR) return { ok: false, error: "Too many codes were sent in the last hour. Wait a while and try again, or use the last code you received." };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await tx.update(onboardingAccess).set({ usedAt: now }).where(and(eq(onboardingAccess.packetId, packet.id), eq(onboardingAccess.kind, "code"), isNull(onboardingAccess.usedAt)));
  // The code's hash, plus a random suffix: two packets (or two sends) can get the same 6 digits.
  await tx.insert(onboardingAccess).values({ orgId: packet.orgId, packetId: packet.id, kind: "code", secretHash: `${sha256(`${packet.id}:${code}`)}:${randomToken()}`, expiresAt: new Date(now.getTime() + CODE_MINUTES * 60_000), createdAt: now });
  await sendMail(tx, { orgId: packet.orgId, to: packet.poaEmail, subject: `Your code: ${code}`, body: `Your code for the move-in paperwork is ${code}. It works for ${CODE_MINUTES} minutes.\n\nIf you didn't ask for it, you can ignore this email.` });
  return { ok: true, message: `We emailed a code to ${mask(packet.poaEmail)}.`, data: { to: mask(packet.poaEmail), code } };
}

/** Checks the code; a right one starts a short session for this onboarding (returned once, for the cookie). */
export async function verifyCode(tx: Tx, packet: Packet, raw: unknown, now = new Date()): Promise<Result<{ session: string; expires: Date }>> {
  const code = typeof raw === "string" ? raw.replace(/\D/g, "") : "";
  const [row] = await tx.select().from(onboardingAccess).where(and(eq(onboardingAccess.packetId, packet.id), eq(onboardingAccess.kind, "code"), isNull(onboardingAccess.usedAt), gt(onboardingAccess.expiresAt, now))).orderBy(desc(onboardingAccess.createdAt)).limit(1);
  if (!row) return { ok: false, error: "That code has expired. Ask for a new one." };
  const tries = row.attempts + 1;
  const right = code.length === 6 && safeEqual(row.secretHash.split(":")[0], sha256(`${packet.id}:${code}`));
  if (!right) {
    await tx.update(onboardingAccess).set({ attempts: tries, ...(tries >= CODE_TRIES && { usedAt: now }) }).where(eq(onboardingAccess.id, row.id));
    return { ok: false, error: tries >= CODE_TRIES ? "Too many wrong codes. Ask for a new one." : "That code isn't right. Check the latest email and try again." };
  }
  await tx.update(onboardingAccess).set({ usedAt: now, attempts: tries }).where(eq(onboardingAccess.id, row.id));
  const session = randomToken();
  const expires = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  await tx.insert(onboardingAccess).values({ orgId: packet.orgId, packetId: packet.id, kind: "session", secretHash: sha256(session), expiresAt: expires, createdAt: now });
  await audit(tx, { orgId: packet.orgId, actorId: null, action: "onboarding_opened_by_family", entity: "organization", entityId: packet.orgId, details: { packetId: packet.id } });
  return { ok: true, message: "Thanks, you're in.", data: { session, expires } };
}

/** Is this browser's session for this onboarding still good? */
export async function familySession(tx: Tx, packet: Packet, session: string | undefined, now = new Date()): Promise<boolean> {
  if (!session) return false;
  const [row] = await tx.select({ id: onboardingAccess.id }).from(onboardingAccess).where(and(eq(onboardingAccess.packetId, packet.id), eq(onboardingAccess.kind, "session"), eq(onboardingAccess.secretHash, sha256(session)), isNull(onboardingAccess.usedAt), gt(onboardingAccess.expiresAt, now)));
  return !!row;
}

/** The top of every form: the organization's logo and name, and the home's address and contact details. */
export interface Letterhead {
  org: string;
  logo: Buffer | null;
  home: string;
  address: string;
  contact: string;
}

/** The letterhead for pages: the logo as an image URL instead of bytes. */
export type LetterheadView = Omit<Letterhead, "logo"> & { logoUrl: string | null };
export const letterheadView = ({ logo, ...rest }: Letterhead): LetterheadView => ({ ...rest, logoUrl: logo ? `data:image/png;base64,${Buffer.from(logo).toString("base64")}` : null });

export async function letterhead(tx: Tx, p: Pick<Packet, "orgId" | "facilityId">): Promise<Letterhead> {
  const [org] = await tx.select({ name: organizations.name, logo: organizations.logo }).from(organizations).where(eq(organizations.id, p.orgId));
  const [home] = await tx.select().from(facilities).where(eq(facilities.id, p.facilityId));
  return { org: org.name, logo: org.logo ?? null, home: home.name, address: addressLine(home), contact: contactLine(home) };
}

/** What the family sees: their checklist, or after admission their signed copies. */
export async function familyView(tx: Tx, packet: Packet) {
  const head = await letterhead(tx, packet);
  const documents = packet.residentId
    ? await tx
        .select({ id: residentDocuments.id, title: residentDocuments.title, contentType: residentDocuments.contentType, sizeBytes: residentDocuments.sizeBytes })
        .from(residentDocuments)
        .where(and(eq(residentDocuments.residentId, packet.residentId), eq(residentDocuments.source, "onboarding"), isNull(residentDocuments.removedAt)))
        .orderBy(asc(residentDocuments.uploadedAt))
    : [];
  return { org: head.org, home: head.home, head: letterheadView(head), packet, items: await itemsOf(tx, packet.id), documents };
}

const family = (p: Packet): Party => ({ who: "poa", userId: null, orgId: p.orgId });

export const familySaveValues = (tx: Tx, p: Packet, itemId: string, raw: Record<string, unknown>, now = new Date()) => saveValues(tx, p, itemId, raw, family(p), now);
export const familySign = (tx: Tx, p: Packet, itemId: string, blockId: string, raw: SignInput, meta: Meta, now = new Date()) => sign(tx, p, itemId, blockId, raw, family(p), meta, now);

/** The family uploads one photo or PDF for a document request. */
export async function familyUpload(tx: Tx, p: Packet, itemId: string, upload: { name: string; data: Buffer }, now = new Date()): Promise<Result> {
  const item = await editableItem(tx, p, itemId);
  if ("error" in item) return { ok: false, error: item.error };
  if (item.kind !== "upload") return { ok: false, error: "That item is a form, not a document upload." };
  if (upload.data.length > MAX_ATTACHMENT_BYTES) return { ok: false, error: `${upload.name} is too large. Use files under 9 MB.` };
  const existing = await tx.select({ id: onboardingFiles.id }).from(onboardingFiles).where(and(eq(onboardingFiles.itemId, item.id), isNull(onboardingFiles.removedAt)));
  if (existing.length >= MAX_FILES_PER_ITEM) return { ok: false, error: `Up to ${MAX_FILES_PER_ITEM} files per item.` };
  const file = await normaliseAttachment(upload.data, upload.name);
  if ("error" in file) return { ok: false, error: file.error };
  await tx.insert(onboardingFiles).values({ orgId: p.orgId, packetId: p.id, itemId: item.id, filename: file.filename, contentType: file.contentType, sizeBytes: file.data.length, data: file.data, uploadedAt: now });
  await tx.update(onboardingItems).set({ status: "todo", updatedAt: now }).where(eq(onboardingItems.id, item.id));
  return { ok: true, message: `${file.filename} uploaded.` };
}

export async function familyRemoveFile(tx: Tx, p: Packet, fileId: string, now = new Date()): Promise<Result> {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return { ok: false, error: "That file isn't here." };
  const [f] = await tx.select().from(onboardingFiles).where(and(eq(onboardingFiles.id, fileId), eq(onboardingFiles.packetId, p.id), isNull(onboardingFiles.removedAt)));
  if (!f) return { ok: false, error: "That file isn't here." };
  const item = await editableItem(tx, p, f.itemId);
  if ("error" in item) return { ok: false, error: item.error };
  await tx.update(onboardingFiles).set({ removedAt: now }).where(eq(onboardingFiles.id, f.id));
  await tx.update(onboardingItems).set({ status: "todo", updatedAt: now }).where(eq(onboardingItems.id, item.id));
  return { ok: true, message: `${f.filename} removed.` };
}

/** A file the family uploaded, for the family to look at again. */
export async function familyFile(tx: Tx, p: Packet, fileId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(fileId)) return null;
  const [f] = await tx.select().from(onboardingFiles).where(and(eq(onboardingFiles.id, fileId), eq(onboardingFiles.packetId, p.id), isNull(onboardingFiles.removedAt)));
  return f ?? null;
}

/** A signed copy, for the family after admission. */
export async function familyDocument(tx: Tx, p: Packet, docId: string) {
  if (!p.residentId || !/^[0-9a-f-]{36}$/i.test(docId)) return null;
  const [d] = await tx.select().from(residentDocuments).where(and(eq(residentDocuments.id, docId), eq(residentDocuments.residentId, p.residentId), eq(residentDocuments.source, "onboarding"), isNull(residentDocuments.removedAt)));
  return d ?? null;
}

/** The family sends a finished item for review; when the whole checklist is in, owners and admins hear about it. */
export async function familySubmit(tx: Tx, p: Packet, itemId: string, now = new Date()): Promise<Result> {
  const item = (await itemsOf(tx, p.id)).find((i) => i.id === itemId);
  if (!item || p.status !== "open") return { ok: false, error: "That form isn't open." };
  if (item.status === "approved") return { ok: true, message: "Already approved." };
  if (item.poaMissing.length) return { ok: false, error: `Still to do: ${item.poaMissing.slice(0, 4).join(", ")}${item.poaMissing.length > 4 ? "…" : ""}.` };
  await tx.update(onboardingItems).set({ status: "submitted", submittedAt: now, updatedAt: now }).where(eq(onboardingItems.id, item.id));
  await audit(tx, { orgId: p.orgId, actorId: null, action: "onboarding_item_submitted", entity: "organization", entityId: p.orgId, details: { packetId: p.id, itemId: item.id } });
  const rest = (await itemsOf(tx, p.id)).filter((i) => i.required && i.status !== "submitted" && i.status !== "approved");
  if (!rest.length) {
    const [home] = await tx.select({ name: facilities.name }).from(facilities).where(eq(facilities.id, p.facilityId));
    const to = await tx.select({ email: users.email }).from(users).where(and(inArray(users.role, ["owner", "admin"]), eq(users.status, "active")));
    for (const { email } of to) {
      await sendMail(tx, { orgId: p.orgId, to: email, subject: `Onboarding ready for review at ${home.name}`, body: `A family has finished the move-in paperwork for a new resident at ${home.name}. Sign in to CareHouse One and open Onboarding to check it, countersign and admit.` });
    }
  }
  return { ok: true, message: rest.length ? `${item.title} sent to the home. ${rest.length} more to go.` : "Everything is sent. The home will check it and let you know." };
}

// ---------------------------------------------------------------- admission

export type Evidence = Array<{ blockId: string; name: string; signer: string; method: string; signedAt: Date; ip: string | null; documentHash: string }>;
export type Renderer = (packet: Packet, item: ItemView, head: Letterhead, evidence: Evidence) => Promise<Buffer>;

/** The signature record for one item (current signatures only), for the signed PDF. */
export async function signatureEvidence(tx: Tx, itemId: string): Promise<Evidence> {
  return tx
    .select({ blockId: onboardingSignatures.blockId, name: onboardingSignatures.name, signer: onboardingSignatures.signer, method: onboardingSignatures.method, signedAt: onboardingSignatures.signedAt, ip: onboardingSignatures.ip, documentHash: onboardingSignatures.documentHash })
    .from(onboardingSignatures)
    .where(and(eq(onboardingSignatures.itemId, itemId), isNull(onboardingSignatures.voidedAt)))
    .orderBy(asc(onboardingSignatures.signedAt));
}

const DOC_CATEGORY_FOR = (title: string, kind: string): string => {
  if (kind === "form") return /consent|photo|media/i.test(title) ? "consent" : "admission";
  if (/attorney|guardian|court/i.test(title)) return "legal";
  if (/insurance|medicaid|medicare|\bid\b|license/i.test(title)) return "id_insurance";
  if (/medic|doctor|physician|order|hospital/i.test(title)) return "medical";
  return "other";
};

/** Answers whose question looks like a resident detail, to fill the admission form in for staff. */
export function suggestResident(p: Packet, items: ItemView[]) {
  const find = (re: RegExp) => {
    for (const i of items) for (const b of i.blocks) if (b.type === "field" && re.test(b.label) && i.values[b.id]) return i.values[b.id];
    return "";
  };
  return {
    firstName: p.residentFirstName,
    lastName: p.residentLastName,
    dateOfBirth: find(/date of birth|birth ?date|\bdob\b/i),
    room: find(/^room/i),
    allergies: find(/allerg/i),
    diet: find(/diet/i),
    guardian: p.poaName,
    guardianRelationship: find(/relationship to the resident/i),
    guardianPhone: find(/^phone$/i),
    guardianEmail: p.poaEmail,
    emergencyName: "",
    emergencyPhone: "",
    admittedOn: find(/move-in date|admission date/i),
  };
}

/**
 * Admits the resident: every required item must be approved. Creates the resident, files a signed
 * PDF of each form and every uploaded document on the resident's record, and emails the family a
 * link to download their signed copies.
 */
export async function admitOnboarding(
  tx: Tx,
  actor: Actor,
  packetId: string,
  raw: Record<string, unknown>,
  render: Renderer,
  appUrl: string,
  now = new Date(),
): Promise<Result<{ residentId: string }>> {
  const p = await packetFor(tx, actor, packetId);
  if (!p || p.status !== "open") return { ok: false, error: "That onboarding isn't open." };
  const items = await itemsOf(tx, p.id);
  const waiting = items.filter((i) => i.required && i.status !== "approved");
  if (waiting.length) return { ok: false, error: `Approve every required item first. Still waiting: ${waiting.map((i) => i.title).slice(0, 3).join(", ")}${waiting.length > 3 ? "…" : ""}.` };
  // "None known" on the family's form means an empty allergy list on the record.
  const allergies = typeof raw.allergies === "string" ? raw.allergies.split(/[,;\n]/).map((s) => s.trim()).filter((s) => s && !/^none( known)?\.?$/i.test(s)).join(", ") : "";
  const created = await createResident(tx, actor, p.orgId, { ...raw, allergies, facilityId: p.facilityId });
  if (!created.ok) return created;
  const residentId = created.data!.id;
  const head = await letterhead(tx, p);
  const org = { name: head.org };
  const home = { name: head.home };
  for (const item of items.filter((i) => i.status === "approved")) {
    if (item.kind === "form") {
      const pdf = await render(p, item, head, await signatureEvidence(tx, item.id));
      await tx.insert(residentDocuments).values({ orgId: p.orgId, residentId, category: DOC_CATEGORY_FOR(item.title, "form"), title: `${item.title} (signed)`, filename: `${item.title.replace(/[^\w .()-]+/g, "").slice(0, 80) || "form"}.pdf`, contentType: "application/pdf", sizeBytes: pdf.length, data: pdf, source: "onboarding", uploadedBy: actor.id, uploadedAt: now });
    } else {
      const files = await tx.select().from(onboardingFiles).where(and(eq(onboardingFiles.itemId, item.id), isNull(onboardingFiles.removedAt)));
      for (const [n, f] of files.entries()) {
        await tx.insert(residentDocuments).values({ orgId: p.orgId, residentId, category: DOC_CATEGORY_FOR(item.title, "upload"), title: files.length > 1 ? `${item.title} (${n + 1} of ${files.length})` : item.title, filename: f.filename, contentType: f.contentType, sizeBytes: f.sizeBytes, data: f.data, source: "onboarding", uploadedBy: actor.id, uploadedAt: now });
      }
    }
  }
  const token = randomToken();
  await tx.update(onboardingPackets).set({ status: "admitted", residentId, admittedAt: now, admittedBy: actor.id, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + DOWNLOAD_DAYS * 86_400_000) }).where(eq(onboardingPackets.id, p.id));
  await tx.update(onboardingAccess).set({ usedAt: now }).where(and(eq(onboardingAccess.packetId, p.id), isNull(onboardingAccess.usedAt)));
  await sendMail(tx, {
    orgId: p.orgId,
    to: p.poaEmail,
    subject: `${org.name}: signed move-in paperwork for ${p.residentFirstName}`,
    body: [
      `Hi ${p.poaName},`,
      "",
      `The move-in paperwork for ${p.residentFirstName} at ${home.name} is complete. You can download your signed copies here:`,
      "",
      `${appUrl}/family/${token}`,
      "",
      `We'll email you a code to confirm it's you. The link works for ${DOWNLOAD_DAYS} days; after that, ask the home for copies.`,
    ].join("\n"),
  });
  await audit(tx, { orgId: p.orgId, actorId: actor.id, action: "onboarding_admitted", entity: "resident", entityId: residentId, details: { packetId: p.id, documents: items.filter((i) => i.status === "approved").length } });
  return { ok: true, message: `${p.residentFirstName} ${p.residentLastName} admitted. The signed forms are on the resident's Documents tab, and the family has been emailed a link to their copies.`, data: { residentId } };
}
