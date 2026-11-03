import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { answerText, WHO_LABEL, withAnswers } from "@/lib/onboarding-forms";
import type { onboardingPackets } from "@/db/schema";
import { E_SIGN_CONSENT, type Evidence, type ItemView, type Letterhead } from "./onboarding";

type Packet = typeof onboardingPackets.$inferSelect;

/** The standard PDF fonts only know Latin-1: straighten quotes and replace anything else. */
const latin = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/✓/g, "")
    .replace(/[^\n\x20-\x7e\xa0-\xff]/g, "?");

const W = 612;
const H = 792;
const M = 54;
const ink = rgb(0.1, 0.1, 0.15);
const grey = rgb(0.4, 0.4, 0.45);

/**
 * A signed onboarding form as a PDF: the wording, every answer, each signature (drawn image or
 * typed name), and a signature record at the end with time, IP and the document fingerprint each
 * signature covers. Letter size, standard fonts, so it opens anywhere.
 */
export async function renderOnboardingPdf(packet: Packet, item: ItemView, head: Letterhead, sigEvidence: Evidence): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(latin(`${item.title} - ${packet.residentFirstName} ${packet.residentLastName}`));
  doc.setProducer("CareHouse One");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const script = await doc.embedFont(StandardFonts.HelveticaOblique);
  let page: PDFPage = doc.addPage([W, H]);
  let y = H - M;

  const ensure = (needed: number) => {
    if (y - needed < M + 20) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, width: number): string[] => {
    const out: string[] = [];
    for (const para of latin(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) line = next;
        else {
          if (line) out.push(line);
          line = word;
        }
      }
      out.push(line);
    }
    return out;
  };
  const write = (text: string, opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number } = {}) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    const lh = size * 1.35;
    for (const line of wrap(text, font, size, W - 2 * M - (opts.indent ?? 0))) {
      ensure(lh);
      page.drawText(line, { x: M + (opts.indent ?? 0), y: y - size, size, font, color: opts.color ?? ink });
      y -= lh;
    }
    y -= opts.gap ?? 4;
  };

  // Letterhead: logo on the left, the organization and the home's address and contact details beside it.
  let textX = 0;
  if (head.logo) {
    const logo = await doc.embedPng(head.logo);
    const scale = Math.min(150 / logo.width, 56 / logo.height);
    page.drawImage(logo, { x: M, y: y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
    textX = logo.width * scale + 14;
  }
  const top = y;
  write(head.org, { font: bold, size: 12, indent: textX, gap: 0 });
  write(head.address ? `${head.home} - ${head.address}` : head.home, { size: 9, color: grey, indent: textX, gap: 0 });
  if (head.contact) write(head.contact, { size: 9, color: grey, indent: textX, gap: 0 });
  if (head.logo) y = Math.min(y, top - 60);
  y -= 10;
  write(item.title, { font: bold, size: 18, gap: 2 });
  write(`Resident: ${packet.residentFirstName} ${packet.residentLastName}  ·  Responsible party: ${packet.poaName}`, { size: 10, color: grey, gap: 10 });
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.8, 0.8, 0.85) });
  y -= 12;

  for (const b of item.blocks) {
    if (b.type === "heading") {
      y -= 4;
      write(withAnswers(b.text, item.blocks, item.values), { font: bold, size: 13 });
    } else if (b.type === "text") {
      write(withAnswers(b.text, item.blocks, item.values), { gap: 8 });
    } else if (b.type === "field") {
      write(`${b.label}`, { font: bold, size: 9.5, color: grey, gap: 1 });
      write(answerText(b, item.values[b.id]) || (b.input === "check" ? "Not agreed" : "-"), { indent: 8, gap: 8 });
    } else {
      const s = item.signatures[b.id];
      ensure(90);
      write(`${b.label} (${WHO_LABEL[b.who]})`, { font: bold, size: 9.5, color: grey, gap: 4 });
      if (s?.image) {
        const png = await doc.embedPng(Buffer.from(s.image.split(",")[1], "base64"));
        const scale = Math.min(200 / png.width, 50 / png.height, 1);
        page.drawImage(png, { x: M + 8, y: y - png.height * scale, width: png.width * scale, height: png.height * scale });
        y -= png.height * scale + 4;
      } else if (s) {
        write(s.name, { font: script, size: 20, indent: 8, gap: 2 });
      }
      page.drawLine({ start: { x: M + 8, y }, end: { x: M + 260, y }, thickness: 0.8, color: grey });
      y -= 4;
      write(s ? `Signed electronically by ${s.name} on ${s.signedAt.toISOString().replace("T", " ").slice(0, 16)} UTC` : "Not signed", { size: 8.5, color: grey, indent: 8, gap: 10 });
    }
  }

  // Signature record
  ensure(140);
  y -= 6;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.8, 0.8, 0.85) });
  y -= 12;
  write("Electronic signature record", { font: bold, size: 11 });
  write(`Each signer agreed: "${E_SIGN_CONSENT}"`, { size: 8.5, color: grey, gap: 6 });
  for (const e of sigEvidence) {
    write(`${e.name} (${e.signer === "poa" ? "responsible party" : "for the home"}), ${e.method}, ${e.signedAt.toISOString()}${e.ip ? `, from ${e.ip}` : ""}`, { size: 8.5, gap: 1 });
    write(`Document fingerprint (SHA-256): ${e.documentHash}`, { size: 7.5, color: grey, gap: 6 });
  }

  const pages = doc.getPages();
  pages.forEach((p, i) => p.drawText(latin(`${item.title} - page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font: regular, color: grey }));
  return Buffer.from(await doc.save());
}
