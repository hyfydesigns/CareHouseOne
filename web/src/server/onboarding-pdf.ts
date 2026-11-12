import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { answerText, asAudience, whoLabel, withAnswers, type Audience, type Block, type Values } from "@/lib/onboarding-forms";
import type { onboardingPackets } from "@/db/schema";
import { E_SIGN_CONSENT, type Evidence, type ItemView, type Letterhead } from "./onboarding";

type Packet = typeof onboardingPackets.$inferSelect;

/** The standard PDF fonts only know Latin-1 (and the bullet): straighten quotes and replace anything else. */
const latin = (s: string) =>
  s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/✓/g, "")
    .replace(/[^\n\x20-\x7e\xa0-\xff•]/g, "?");

const W = 612;
const H = 792;
const M = 54;
const ink = rgb(0.1, 0.1, 0.15);
const grey = rgb(0.4, 0.4, 0.45);
const rule = rgb(0.8, 0.8, 0.85);

type WriteOpts = { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gap?: number };

/** A Letter-size document written top to bottom, with a new page whenever the current one fills up. */
export async function writer(title: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(latin(title));
  doc.setProducer("CareHouse One");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const script = await doc.embedFont(StandardFonts.HelveticaOblique);
  const w = {
    doc,
    regular,
    bold,
    script,
    page: doc.addPage([W, H]) as PDFPage,
    y: H - M,
    ensure(needed: number) {
      if (w.y - needed < M + 20) {
        w.page = doc.addPage([W, H]);
        w.y = H - M;
      }
    },
    wrap(text: string, font: PDFFont, size: number, width: number): string[] {
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
    },
    write(text: string, opts: WriteOpts = {}) {
      const font = opts.font ?? regular;
      const size = opts.size ?? 10.5;
      const lh = size * 1.35;
      for (const line of w.wrap(text, font, size, W - 2 * M - (opts.indent ?? 0))) {
        w.ensure(lh);
        w.page.drawText(line, { x: M + (opts.indent ?? 0), y: w.y - size, size, font, color: opts.color ?? ink });
        w.y -= lh;
      }
      w.y -= opts.gap ?? 4;
    },
    line(x1: number, x2: number) {
      w.page.drawLine({ start: { x: x1, y: w.y }, end: { x: x2, y: w.y }, thickness: 0.8, color: grey });
    },
    divider() {
      w.page.drawLine({ start: { x: M, y: w.y }, end: { x: W - M, y: w.y }, thickness: 1, color: rule });
      w.y -= 12;
    },
    /** Logo on the left, the organization and the home's address and contact details beside it. */
    async letterhead(head: Letterhead) {
      let textX = 0;
      if (head.logo) {
        const logo = await doc.embedPng(head.logo);
        const scale = Math.min(150 / logo.width, 56 / logo.height);
        w.page.drawImage(logo, { x: M, y: w.y - logo.height * scale, width: logo.width * scale, height: logo.height * scale });
        textX = logo.width * scale + 14;
      }
      const top = w.y;
      w.write(head.org, { font: bold, size: 12, indent: textX, gap: 0 });
      const where = [head.home, head.address].filter(Boolean).join(" - ");
      if (where) w.write(where, { size: 9, color: grey, indent: textX, gap: 0 });
      if (head.contact) w.write(head.contact, { size: 9, color: grey, indent: textX, gap: 0 });
      if (head.logo) w.y = Math.min(w.y, top - 60);
      w.y -= 10;
    },
    async save(footer: string): Promise<Buffer> {
      const pages = doc.getPages();
      pages.forEach((p, i) => p.drawText(latin(`${footer} - page ${i + 1} of ${pages.length}`), { x: M, y: 28, size: 8, font: regular, color: grey }));
      return Buffer.from(await doc.save());
    },
  };
  return w;
}

/**
 * A signed onboarding form as a PDF: the wording, every answer, each signature (drawn image or
 * typed name), and a signature record at the end with time, IP and the document fingerprint each
 * signature covers. Letter size, standard fonts, so it opens anywhere.
 */
export async function renderOnboardingPdf(packet: Packet, item: ItemView, head: Letterhead, sigEvidence: Evidence): Promise<Buffer> {
  const audience = asAudience(packet.audience);
  const staff = audience === "staff";
  const w = await writer(`${item.title} - ${packet.residentFirstName} ${packet.residentLastName}`);
  const { bold, script } = w;
  await w.letterhead(head);
  w.write(item.title, { font: bold, size: 18, gap: 2 });
  w.write(staff ? `Employee: ${packet.poaName}` : `Resident: ${packet.residentFirstName} ${packet.residentLastName}  ·  Responsible party: ${packet.poaName}`, { size: 10, color: grey, gap: 10 });
  w.divider();

  for (const b of item.blocks) {
    if (b.type === "heading") {
      w.y -= 4;
      w.write(withAnswers(b.text, item.blocks, item.values), { font: bold, size: 13 });
    } else if (b.type === "text") {
      w.write(withAnswers(b.text, item.blocks, item.values), { gap: 8 });
    } else if (b.type === "field") {
      w.write(`${b.label}`, { font: bold, size: 9.5, color: grey, gap: 1 });
      w.write(answerText(b, item.values[b.id]) || (b.input === "check" ? "Not agreed" : "-"), { indent: 8, gap: 8 });
    } else {
      const s = item.signatures[b.id];
      w.ensure(90);
      w.write(`${b.label} (${whoLabel(b.who, audience)})`, { font: bold, size: 9.5, color: grey, gap: 4 });
      if (s?.image) {
        const png = await w.doc.embedPng(Buffer.from(s.image.split(",")[1], "base64"));
        const scale = Math.min(200 / png.width, 50 / png.height, 1);
        w.page.drawImage(png, { x: M + 8, y: w.y - png.height * scale, width: png.width * scale, height: png.height * scale });
        w.y -= png.height * scale + 4;
      } else if (s) {
        w.write(s.name, { font: script, size: 20, indent: 8, gap: 2 });
      }
      w.line(M + 8, M + 260);
      w.y -= 4;
      w.write(s ? `Signed electronically by ${s.name} on ${s.signedAt.toISOString().replace("T", " ").slice(0, 16)} UTC` : "Not signed", { size: 8.5, color: grey, indent: 8, gap: 10 });
    }
  }

  // Signature record
  w.ensure(140);
  w.y -= 6;
  w.divider();
  w.write("Electronic signature record", { font: bold, size: 11 });
  w.write(`Each signer agreed: "${E_SIGN_CONSENT}"`, { size: 8.5, color: grey, gap: 6 });
  for (const e of sigEvidence) {
    w.write(`${e.name} (${e.signer === "poa" ? (staff ? "employee" : "responsible party") : "for the home"}), ${e.method}, ${e.signedAt.toISOString()}${e.ip ? `, from ${e.ip}` : ""}`, { size: 8.5, gap: 1 });
    w.write(`Document fingerprint (SHA-256): ${e.documentHash}`, { size: 7.5, color: grey, gap: 6 });
  }
  return w.save(item.title);
}

export interface PaperForm {
  title: string;
  description?: string;
  blocks: Block[];
  /** Answers already given (the home's fees, say); everything else is left blank to write in. */
  values?: Values;
  audience: Audience;
  /** Who it's for, when printed from someone's onboarding; blank lines to write the names on otherwise. */
  names?: { resident?: string; person?: string };
}

/**
 * A form printed to fill in by hand, for someone who can't do it online: the same wording and
 * questions, with lines to write on, boxes to tick and signature lines with a date. The home scans
 * the signed copy back in.
 */
export async function renderPaperFormPdf(form: PaperForm, head: Letterhead): Promise<Buffer> {
  const values = form.values ?? {};
  const staff = form.audience === "staff";
  const w = await writer(form.title);
  const { regular, bold } = w;
  const BOX = 9;
  const box = (x: number, ticked: boolean) => {
    w.page.drawRectangle({ x, y: w.y - BOX - 1, width: BOX, height: BOX, borderColor: ink, borderWidth: 0.8 });
    if (ticked) {
      w.page.drawLine({ start: { x: x + 2, y: w.y - 3 }, end: { x: x + BOX - 2, y: w.y - BOX + 1 }, thickness: 1.2, color: ink });
      w.page.drawLine({ start: { x: x + BOX - 2, y: w.y - 3 }, end: { x: x + 2, y: w.y - BOX + 1 }, thickness: 1.2, color: ink });
    }
  };
  /** "Label ____________" on one line, the answer written on the line when there is one. */
  const blank = (label: string, answer: string, x: number, end: number) => {
    w.page.drawText(latin(label), { x, y: w.y - 10, size: 10, font: regular, color: ink });
    const start = x + regular.widthOfTextAtSize(latin(label), 10) + 4;
    if (answer) w.page.drawText(latin(answer), { x: start + 4, y: w.y - 10, size: 10.5, font: bold, color: ink });
    w.page.drawLine({ start: { x: start, y: w.y - 12 }, end: { x: end, y: w.y - 12 }, thickness: 0.6, color: grey });
  };

  await w.letterhead(head);
  w.write(form.title, { font: bold, size: 18, gap: 6 });
  w.ensure(40);
  const half = (W - 2 * M) / 2 - 10;
  if (staff) blank("Employee:", form.names?.person ?? "", M, W - M);
  else {
    blank("Resident:", form.names?.resident ?? "", M, M + half);
    blank("Responsible party:", form.names?.person ?? "", M + half + 20, W - M);
  }
  w.y -= 22;
  if (form.description) w.write(form.description, { size: 9.5, color: grey, gap: 6 });
  w.write("Please print clearly in ink. Tick one box where there are choices, and sign and date each signature line.", { size: 9, color: grey, gap: 8 });
  w.divider();

  for (const b of form.blocks) {
    if (b.type === "heading") {
      w.y -= 4;
      w.write(withAnswers(b.text, form.blocks, values), { font: bold, size: 13 });
    } else if (b.type === "text") {
      w.write(withAnswers(b.text, form.blocks, values), { gap: 8 });
    } else if (b.type === "field") {
      const v = values[b.id] ?? "";
      w.ensure(b.input === "long" ? 80 : 40);
      w.write(`${b.label}${b.required ? "" : " (optional)"}${b.who === "staff" ? "  (for the home)" : ""}`, { font: bold, size: 9.5, color: grey, gap: 2 });
      if (b.help) w.write(b.help, { size: 8.5, color: grey, indent: 8, gap: 2 });
      if (b.input === "yesno" || b.input === "check") {
        const opts = b.input === "check" ? [["yes", "I agree"]] : [["yes", "Yes"], ["no", "No"]];
        w.ensure(16);
        let x = M + 8;
        for (const [val, label] of opts) {
          box(x, v === val);
          w.page.drawText(label, { x: x + BOX + 5, y: w.y - BOX, size: 10, font: regular, color: ink });
          x += BOX + 5 + regular.widthOfTextAtSize(label, 10) + 24;
        }
        w.y -= 20;
      } else if (b.input === "choice") {
        for (const o of b.options ?? []) {
          w.ensure(16);
          box(M + 8, v === o);
          w.write(o, { indent: 8 + BOX + 6, gap: 1 });
          const help = b.optionHelp?.[o];
          if (help) w.write(help, { size: 8.5, color: grey, indent: 8 + BOX + 6, gap: 3 });
        }
        w.y -= 6;
      } else if (b.input === "long") {
        if (v) w.write(v, { indent: 8, gap: 6 });
        else
          for (let n = 0; n < 3; n++) {
            w.y -= 20;
            w.line(M + 8, W - M);
          }
        w.y -= 12;
      } else {
        const answer = answerText(b, v);
        w.ensure(22);
        blank(b.input === "money" ? "$" : "", answer.replace(/^\$/, ""), M + 8, b.input === "date" ? M + 200 : W - M);
        if (b.input === "date" && !answer) w.page.drawText("MM / DD / YYYY", { x: M + 210, y: w.y - 10, size: 8, font: regular, color: grey });
        w.y -= 24;
      }
    } else {
      w.ensure(70);
      w.y -= 4;
      w.write(`${b.label} (${whoLabel(b.who, form.audience)})`, { font: bold, size: 9.5, color: grey, gap: 18 });
      blank("Signature:", "", M + 8, M + 330);
      blank("Date:", "", M + 350, W - M);
      w.y -= 26;
      blank("Printed name:", "", M + 8, M + 330);
      w.y -= 26;
    }
  }
  return w.save(`${form.title} - paper copy`);
}
