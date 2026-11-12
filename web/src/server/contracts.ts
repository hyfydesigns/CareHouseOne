import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { contracts, organizations, platformAdmins, subscriptions, users, type Contract } from "@/db/schema";
import { cents, CYCLE_DAY, dayIn, DUE_DAY, LATE_DAY, LATE_FEE, scheduleStarting, showDay, showPeriod, cycleEnding, type Day } from "@/lib/billing-cycle";
import { CONTRACT_TERMS, CONTRACT_VERSION, type ContractPart } from "@/lib/contract-text";
import { randomToken, sha256 } from "@/lib/crypto";
import { INTRO_PRICE_PER_HOME, PRICE_PER_HOME, TRIAL_DAYS, usd } from "@/lib/pricing";
import { adminLog } from "./admin-auth";
import { audit, sendMail } from "./audit";
import { orgBill, scheduleOf, startInvoiceBilling } from "./billing";
import { writer } from "./onboarding-pdf";
import { heldOwners, inviteOwner } from "./provision";

/** Days a client has to sign; a reminder gives them the same again. */
export const SIGN_DAYS = 30;
/** After signing, the link keeps working this long so they can download their copy. */
const KEEP_DAYS = 365;

export const CONTRACT_CONSENT =
  "I agree to sign electronically, and my electronic signature means the same as my handwritten signature. I confirm I'm authorized to sign for the organization named above.";

/** What the client signs, stored with the contract exactly as sent. */
export interface ContractDocument {
  version: string;
  issuedOn: Day;
  client: { orgName: string; signerName: string; signerEmail: string };
  /** paypal_subscription: they already pay through a PayPal subscription. paypal_invoice: billed by PayPal invoice. */
  billing: "paypal_subscription" | "paypal_invoice";
  homes: number;
  /** paypal_invoice only: the first day billed, and the introductory months. */
  startsOn: Day | null;
  introMonths: number;
  /** The order form, as numbered lines. */
  order: Array<{ label: string; text: string }>;
  note: string | null;
  terms: ContractPart[];
}

export const sendSchema = z.object({
  signerName: z.string().trim().min(2, "Enter the signer's name.").max(120),
  signerEmail: z.string().trim().toLowerCase().email("Enter the signer's email address."),
  homes: z.coerce.number().int().min(1, "At least 1 home.").max(500),
  startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  introMonths: z.coerce.number().int().min(0).max(12).default(3),
  note: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** The order form lines for a client: who, how many homes, the price, how and when they're billed. */
export function orderLines(d: Omit<ContractDocument, "order" | "terms" | "version">, paypalNote?: string): ContractDocument["order"] {
  const lines: ContractDocument["order"] = [
    { label: "Customer", text: d.client.orgName },
    { label: "Service", text: "CareHouse One care records for group homes, as described in the Terms of Service below." },
    { label: "Homes", text: `${d.homes} to start. Each invoice is for the number of homes on the account the day it's issued.` },
  ];
  if (d.billing === "paypal_subscription") {
    lines.push(
      { label: "Price", text: `${usd(INTRO_PRICE_PER_HOME)} per home per month at first, then ${usd(PRICE_PER_HOME)} per home per month, as set out in section 3.1 of the Terms.` },
      { label: "Payment", text: `By the customer's existing PayPal subscription, charged automatically on the ${DUE_DAY}th of each month.${paypalNote ? ` ${paypalNote}` : ""}` },
    );
  } else {
    const s = scheduleStarting(d.startsOn!, d.introMonths);
    const first = cycleEnding(s, s.firstCycleEnd)!;
    // Starting on any day but the 28th makes the first cycle a part-month.
    const partial = !d.startsOn!.endsWith(`-${CYCLE_DAY}`);
    lines.push({
      label: "Price",
      text:
        d.introMonths > 0
          ? `${usd(INTRO_PRICE_PER_HOME)} per home per month (introductory price) for the first ${partial ? `part-month and the following ${s.introCycles} months` : `${s.introCycles + 1} months`}, then ${usd(PRICE_PER_HOME)} per home per month.`
          : `${usd(PRICE_PER_HOME)} per home per month.`,
    });
    lines.push(
      { label: "Billing starts", text: `${showDay(d.startsOn!, true)}. The first invoice covers ${showPeriod(first)} at ${cents(first.perHomeCents)} per home, issued ${showDay(first.invoiceOn, true)} and due ${showDay(first.dueOn, true)}.` },
      { label: "Payment", text: `By PayPal invoice, payable by card or with PayPal, instead of automatic payment (section 3.5 of the Terms). Billing cycles run from the ${CYCLE_DAY}th to the ${CYCLE_DAY}th; each invoice is emailed the day after a cycle ends and is due on the ${DUE_DAY}th. A payment not received by the ${LATE_DAY}th is late (${usd(LATE_FEE)} late fee, section 3.7).` },
    );
  }
  lines.push({ label: "Term", text: "Month to month, with no minimum term. Either party may end it as set out in section 9 of the Terms." });
  if (d.note) lines.push({ label: "Other terms", text: d.note });
  return lines;
}

/** Sends a client a contract to sign. Returns the signing link (also emailed to the signer). */
export async function sendContract(db: DB, adminId: string, orgId: string, raw: unknown, appUrl: string, now = new Date()): Promise<{ ok: true; id: string; link: string } | { ok: false; error: string }> {
  const p = sendSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId));
  if (!org) return { ok: false, error: "No such client." };
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  const onPaypal = !!sub && sub.billingMethod === "paypal" && !sub.cancelledOn;
  if (sub && !onPaypal && sub.billingMethod === "invoice" && !sub.cancelledOn) {
    return { ok: false, error: "This client is already billed by PayPal invoice. A new order form would set up billing twice; edit billing on the client page instead." };
  }
  if (!onPaypal && !p.data.startsOn) return { ok: false, error: "Choose the date billing starts." };
  const base = {
    issuedOn: dayIn(now),
    client: { orgName: org.name, signerName: p.data.signerName, signerEmail: p.data.signerEmail },
    billing: onPaypal ? ("paypal_subscription" as const) : ("paypal_invoice" as const),
    homes: p.data.homes,
    startsOn: onPaypal ? null : p.data.startsOn!,
    introMonths: onPaypal ? 0 : p.data.introMonths,
    note: p.data.note || null,
  };
  const schedule = sub ? scheduleOf(sub) : null;
  const paypalNote = onPaypal && schedule ? `Introductory pricing as agreed at sign-up; the first payment is ${showDay(schedule.startsOn, true)}.` : undefined;
  const document: ContractDocument = { version: CONTRACT_VERSION, ...base, order: orderLines(base, paypalNote), terms: CONTRACT_TERMS };
  const token = randomToken();
  const [c] = await db
    .insert(contracts)
    .values({
      orgId,
      signerName: p.data.signerName,
      signerEmail: p.data.signerEmail,
      document: document as unknown as Record<string, unknown>,
      version: CONTRACT_VERSION,
      tokenHash: sha256(token),
      expiresAt: new Date(now.getTime() + SIGN_DAYS * 86_400_000),
      sentAt: now,
      createdBy: adminId,
    })
    .returning();
  const link = `${appUrl}/contract/${token}`;
  await mailLink(db, c, link, false);
  await adminLog(db, { adminId, orgId, action: "contract_sent", entity: "contract", entityId: c.id, details: { to: c.signerEmail, billing: document.billing } });
  await audit(db, { orgId, actorId: null, action: "contract_sent", entity: "contract", entityId: c.id, details: { to: c.signerEmail } });
  return { ok: true, id: c.id, link };
}

async function mailLink(db: DB, c: Contract, link: string, reminder: boolean) {
  const d = c.document as unknown as ContractDocument;
  await sendMail(db, {
    orgId: c.orgId,
    to: c.signerEmail,
    subject: reminder ? "Reminder: your CareHouse One agreement is ready to sign" : "Your CareHouse One agreement is ready to sign",
    body:
      `Hello ${c.signerName},\n\n` +
      `Here is the CareHouse One agreement for ${d.client.orgName}: the order form, the Terms of Service and the Business Associate Agreement. Please read it and sign online:\n\n${link}\n\n` +
      `The link is just for you and works for ${SIGN_DAYS} days. You can sign on a phone or computer by drawing or typing your name, and you'll get a PDF copy once it's signed.\n\n` +
      `Questions? Just reply to this email.`,
  });
}

/** A new link for an unsigned contract (only a hash of the old one was kept), with another 30 days. */
export async function remindContract(db: DB, adminId: string, id: string, appUrl: string, now = new Date()): Promise<{ ok: true; link: string } | { ok: false; error: string }> {
  const [c] = await db.select().from(contracts).where(eq(contracts.id, id));
  if (!c || c.status !== "sent") return { ok: false, error: "Only a contract that's waiting for a signature can be resent." };
  const token = randomToken();
  const [updated] = await db
    .update(contracts)
    .set({ tokenHash: sha256(token), expiresAt: new Date(now.getTime() + SIGN_DAYS * 86_400_000), remindedAt: now })
    .where(eq(contracts.id, id))
    .returning();
  const link = `${appUrl}/contract/${token}`;
  await mailLink(db, updated, link, true);
  await adminLog(db, { adminId, orgId: c.orgId, action: "contract_resent", entity: "contract", entityId: id });
  return { ok: true, link };
}

export async function voidContract(db: DB, adminId: string, id: string, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const rows = await db.update(contracts).set({ status: "void", voidedAt: now }).where(and(eq(contracts.id, id), eq(contracts.status, "sent"))).returning();
  if (!rows.length) return { ok: false, error: "Only an unsigned contract can be voided." };
  await adminLog(db, { adminId, orgId: rows[0].orgId, action: "contract_voided", entity: "contract", entityId: id });
  return { ok: true };
}

/** The contract a signing link opens (signed ones stay viewable for a year), noting the first view. */
export async function contractByToken(db: DB, token: string, now = new Date()): Promise<Contract | null> {
  if (!token || token.length > 100) return null;
  const [c] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.tokenHash, sha256(token)), inArray(contracts.status, ["sent", "signed"]), gt(contracts.expiresAt, now)));
  if (!c) return null;
  if (!c.viewedAt) {
    await db.update(contracts).set({ viewedAt: now }).where(and(eq(contracts.id, c.id), isNull(contracts.viewedAt)));
    return { ...c, viewedAt: now };
  }
  return c;
}

export const documentHash = (c: Pick<Contract, "document">) => sha256(JSON.stringify(c.document));

const signSchema = z.object({
  name: z.string().trim().min(2, "Type your full name.").max(120),
  title: z.string().trim().min(2, "Enter your title, for example Owner.").max(80),
  method: z.enum(["drawn", "typed"]),
  image: z.string().max(300_000).optional(),
  consent: z.literal(true, { message: "Agree to sign electronically to continue." }),
});

/**
 * The client signs. Keeps the signature with the time, their IP and browser, and a fingerprint of
 * the exact document. A client to be billed by invoice starts on the order form's terms.
 */
export async function signContract(
  db: DB,
  token: string,
  raw: unknown,
  meta: { ip: string; userAgent?: string; appUrl: string },
  now = new Date(),
): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = signSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (p.data.method === "drawn" && !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(p.data.image ?? "")) return { ok: false, error: "Draw your signature, or type it instead." };
  const c = await contractByToken(db, token, now);
  if (!c) return { ok: false, error: "This link has expired. Ask CareHouse One for a new one." };
  if (c.status !== "sent") return { ok: false, error: "This agreement is already signed." };
  const [signed] = await db
    .update(contracts)
    .set({
      status: "signed",
      signedAt: now,
      signedName: p.data.name,
      signedTitle: p.data.title,
      signMethod: p.data.method,
      signatureImage: p.data.method === "drawn" ? p.data.image! : null,
      signerIp: meta.ip.slice(0, 64),
      signerUserAgent: meta.userAgent?.slice(0, 300) ?? null,
      documentHash: documentHash(c),
      expiresAt: new Date(now.getTime() + KEEP_DAYS * 86_400_000),
    })
    .where(and(eq(contracts.id, c.id), eq(contracts.status, "sent")))
    .returning();
  if (!signed) return { ok: false, error: "This agreement is already signed." };
  const d = c.document as unknown as ContractDocument;
  let billingNote = "";
  if (d.billing === "paypal_invoice") {
    const r = await startInvoiceBilling(db, c.orgId, { billingEmail: c.signerEmail, startsOn: d.startsOn!, introMonths: d.introMonths }, now);
    billingNote = r.ok ? ` Billing by PayPal invoice starts ${showDay(d.startsOn!, true)}.` : ` Billing wasn't started automatically: ${r.error}`;
  }
  // An owner whose invitation was held until now gets it.
  let inviteNote = "";
  const held = await heldOwners(db, c.orgId);
  for (const o of held) {
    await inviteOwner(db, { orgId: c.orgId, orgName: d.client.orgName, user: o }, meta.appUrl);
    await audit(db, { orgId: c.orgId, actorId: null, action: "invitation_sent", entity: "user", entityId: o.id, details: { by: "CareHouse One", after: "contract_signed" } });
    inviteNote += ` ${o.name} (${o.email}) was emailed an invitation to set up the account.`;
  }
  await audit(db, { orgId: c.orgId, actorId: null, action: "contract_signed", entity: "contract", entityId: c.id, details: { by: p.data.name, title: p.data.title, method: p.data.method, documentHash: signed.documentHash } });
  await adminLog(db, { adminId: null, orgId: c.orgId, action: "contract_signed", entity: "contract", entityId: c.id, details: { by: p.data.name, billingNote: billingNote.trim() || null, invited: inviteNote.trim() || null } });
  await sendMail(db, {
    orgId: c.orgId,
    to: c.signerEmail,
    subject: "Your signed CareHouse One agreement",
    body: `Thank you, ${p.data.name}. Your CareHouse One agreement for ${d.client.orgName} is signed.\n\nDownload your copy (PDF) from the same link for the next year:\n${meta.appUrl}/contract/${token}\n\nKeep a copy for your records.`,
  });
  const admins = await db.select({ email: platformAdmins.email }).from(platformAdmins).where(isNull(platformAdmins.disabledAt));
  for (const a of admins) {
    await sendMail(db, { orgId: null, to: a.email, subject: `Contract signed: ${d.client.orgName}`, body: `${p.data.name} (${p.data.title}) signed the CareHouse One agreement for ${d.client.orgName}.${billingNote}${inviteNote}` });
  }
  return { ok: true };
}

export async function orgContracts(db: DB, orgId: string): Promise<Contract[]> {
  return db.select().from(contracts).where(eq(contracts.orgId, orgId)).orderBy(desc(contracts.sentAt));
}

/** Defaults for a new contract: the owner signs, for the homes they have. */
export async function contractDefaults(db: DB, orgId: string) {
  const [owner] = await db.select().from(users).where(and(eq(users.orgId, orgId), eq(users.role, "owner"))).limit(1);
  const { homes } = await orgBill(db, orgId);
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.orgId, orgId));
  return { signerName: owner?.name ?? "", signerEmail: owner?.email ?? "", homes: Math.max(1, homes), onPaypal: !!sub && sub.billingMethod === "paypal" && !sub.cancelledOn, trialDays: TRIAL_DAYS };
}

/** The signed (or unsigned) agreement as a PDF: order form, terms, signature and signature record. */
export async function renderContractPdf(c: Contract): Promise<Buffer> {
  const d = c.document as unknown as ContractDocument;
  const w = await writer(`CareHouse One agreement - ${d.client.orgName}`);
  const { bold, script } = w;
  w.write("CareHouse One", { font: bold, size: 12, gap: 0 });
  w.write("Order form, Terms of Service and Business Associate Agreement", { size: 9, gap: 10 });
  w.write(`Agreement with ${d.client.orgName}`, { font: bold, size: 17, gap: 2 });
  w.write(`Issued ${showDay(d.issuedOn, true)} · ${d.version}`, { size: 9.5, gap: 10 });
  w.divider();
  w.write("Order form", { font: bold, size: 13 });
  d.order.forEach((l, i) => {
    w.write(`${i + 1}. ${l.label}`, { font: bold, size: 9.5, gap: 1 });
    w.write(l.text, { indent: 12, gap: 6 });
  });
  w.write("This order form and the Terms of Service and Business Associate Agreement below are one agreement. If they conflict, the order form controls.", { size: 9.5, gap: 10 });
  for (const part of d.terms) {
    w.ensure(60);
    w.y -= 6;
    w.divider();
    w.write(part.title, { font: bold, size: 14 });
    for (const b of part.blocks) {
      if (b.type === "h") {
        w.y -= 2;
        w.write(b.text, { font: bold, size: 11 });
      } else if (b.type === "li") w.write(`•  ${b.text}`, { indent: 10, gap: 3 });
      else if (b.type === "p") w.write(b.text, { gap: 6 });
      else if (b.type === "table") {
        const [head, ...rows] = b.rows;
        for (const r of rows) {
          w.write(r[0], { font: bold, size: 9.5, gap: 1 });
          r.slice(1).forEach((cell, i) => w.write(`${head[i + 1]}: ${cell}`, { size: 9, indent: 10, gap: 1 }));
          w.y -= 4;
        }
      }
    }
  }
  w.ensure(170);
  w.y -= 6;
  w.divider();
  w.write(`Signed for ${d.client.orgName}`, { font: bold, size: 11, gap: 6 });
  if (c.status === "signed") {
    if (c.signatureImage) {
      const png = await w.doc.embedPng(Buffer.from(c.signatureImage.split(",")[1], "base64"));
      const scale = Math.min(220 / png.width, 55 / png.height, 1);
      w.page.drawImage(png, { x: 62, y: w.y - png.height * scale, width: png.width * scale, height: png.height * scale });
      w.y -= png.height * scale + 4;
    } else w.write(c.signedName ?? "", { font: script, size: 22, indent: 8, gap: 2 });
    w.line(62, 62 + 260);
    w.y -= 4;
    w.write(`${c.signedName}, ${c.signedTitle}`, { size: 10, indent: 8, gap: 1 });
    w.write(`Signed electronically on ${c.signedAt!.toISOString().replace("T", " ").slice(0, 16)} UTC`, { size: 8.5, indent: 8, gap: 12 });
    w.write("Electronic signature record", { font: bold, size: 10 });
    w.write(`The signer agreed: "${CONTRACT_CONSENT}"`, { size: 8.5, gap: 2 });
    w.write(`Sent to ${c.signerEmail} on ${c.sentAt.toISOString()}; signed ${c.signedAt!.toISOString()} (${c.signMethod})${c.signerIp ? ` from ${c.signerIp}` : ""}.`, { size: 8.5, gap: 2 });
    w.write(`Document fingerprint (SHA-256): ${c.documentHash}`, { size: 7.5, gap: 2 });
  } else {
    w.write(c.status === "void" ? "This agreement was withdrawn and is not in effect." : "Not signed yet.", { size: 10, indent: 8 });
  }
  return w.save(`CareHouse One agreement - ${d.client.orgName}`);
}
