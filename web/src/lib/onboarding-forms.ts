import { z } from "zod";

/**
 * Onboarding forms are written in the app, not uploaded: a list of blocks (headings, paragraphs,
 * fields and signature lines). Each field and signature belongs to someone: the family's power of
 * attorney ("poa") or the home's staff ("staff"). The same blocks drive the form builder, the
 * family's page, staff review and the signed PDF.
 */
export type Who = "poa" | "staff";
export const WHO_LABEL: Record<Who, string> = { poa: "Family / POA", staff: "Staff" };
/** "To be filled in by …" */
export const WHO_PHRASE: Record<Who, string> = { poa: "the family", staff: "the home" };

export const INPUTS = {
  text: "Short answer",
  long: "Long answer",
  date: "Date",
  yesno: "Yes or no",
  choice: "Choose one",
  check: "Checkbox (I agree / I confirm)",
} as const;
export type InputKind = keyof typeof INPUTS;

export type Block =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "text"; text: string }
  | { id: string; type: "field"; label: string; input: InputKind; options?: string[]; required: boolean; who: Who; help?: string }
  | { id: string; type: "signature"; label: string; who: Who };

/** What a form asks for: blocks to fill and sign, or files to upload (ID cards, court papers). */
export const FORM_KINDS = { form: "Form to fill and sign", upload: "Documents to upload" } as const;
export type FormKind = keyof typeof FORM_KINDS;

const id = z.string().regex(/^[a-z0-9]{4,24}$/);
const who = z.enum(["poa", "staff"]);
export const blockSchema = z.discriminatedUnion("type", [
  z.object({ id, type: z.literal("heading"), text: z.string().trim().min(1, "A heading is empty.").max(200) }),
  z.object({ id, type: z.literal("text"), text: z.string().trim().min(1, "A paragraph is empty.").max(8000) }),
  z.object({
    id,
    type: z.literal("field"),
    label: z.string().trim().min(1, "A field has no question.").max(300),
    input: z.enum(Object.keys(INPUTS) as [InputKind, ...InputKind[]]),
    options: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    required: z.boolean(),
    who,
    help: z.string().trim().max(300).optional(),
  }),
  z.object({ id, type: z.literal("signature"), label: z.string().trim().min(1, "A signature line has no label.").max(200), who }),
]);
export const formSchema = z
  .object({
    title: z.string().trim().min(2, "Give the form a title.").max(120),
    description: z.string().trim().max(1000).default(""),
    kind: z.enum(["form", "upload"]),
    required: z.boolean(),
    blocks: z.array(blockSchema).max(200),
  })
  .superRefine((f, ctx) => {
    if (f.kind === "form" && !f.blocks.some((b) => b.type === "field" || b.type === "signature")) ctx.addIssue({ code: "custom", message: "Add at least one field or signature line." });
    for (const b of f.blocks) if (b.type === "field" && b.input === "choice" && (b.options?.length ?? 0) < 2) ctx.addIssue({ code: "custom", message: `"${b.label}" needs at least two choices.` });
    if (new Set(f.blocks.map((b) => b.id)).size !== f.blocks.length) ctx.addIssue({ code: "custom", message: "Two blocks have the same id." });
  });
export type FormDef = z.infer<typeof formSchema>;

/** Field answers by block id; yes/no and checkboxes are "yes"/"no"/"" too. */
export type Values = Record<string, string>;

export const newBlockId = () => Math.random().toString(36).slice(2, 10).padEnd(6, "0");

/** The fields and signatures someone still has to complete. */
export function missingFor(blocks: Block[], values: Values, signed: Set<string>, w: Who): string[] {
  const out: string[] = [];
  for (const b of blocks) {
    if (b.type === "field" && b.who === w && b.required && (b.input === "check" ? values[b.id] !== "yes" : !(values[b.id] ?? "").trim())) out.push(b.label);
    if (b.type === "signature" && b.who === w && !signed.has(b.id)) out.push(b.label);
  }
  return out;
}

/** Checks and cleans one person's answers: only their own fields, in the right shape. */
export function cleanValues(blocks: Block[], raw: Record<string, unknown>, w: Who): Values {
  const out: Values = {};
  for (const b of blocks) {
    if (b.type !== "field" || b.who !== w) continue;
    const v = typeof raw[b.id] === "string" ? (raw[b.id] as string).trim() : "";
    if (!v) continue;
    if (b.input === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    if ((b.input === "yesno" || b.input === "check") && v !== "yes" && v !== "no") continue;
    if (b.input === "choice" && !(b.options ?? []).includes(v)) continue;
    out[b.id] = v.slice(0, b.input === "long" ? 4000 : 300);
  }
  return out;
}

/** How an answer reads on screen and on paper. */
export function answerText(b: Extract<Block, { type: "field" }>, v: string | undefined): string {
  if (!v) return "";
  if (b.input === "yesno") return v === "yes" ? "Yes" : "No";
  if (b.input === "check") return v === "yes" ? "✓ Agreed" : "";
  return v;
}
