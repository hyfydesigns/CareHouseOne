/**
 * Regenerates src/lib/contract-text.ts from legal/terms-and-baa.md (the Terms of Service, BAA and
 * subprocessor exhibit that clients sign with their order form).
 *
 *   npm run contract:text
 *
 * Markdown it understands: "# Part", "## Heading", "- item", paragraphs, pipe tables, **bold**
 * (bold is dropped). Bump CONTRACT_VERSION below when the text changes; contracts already sent
 * keep the copy they were sent with.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const CONTRACT_VERSION = "Version 1.4 of November 14, 2026";
/** Set to true once a lawyer has reviewed the text. Until then the admin site warns before sending. */
const REVIEWED = true;

type Block = { type: "h" | "p" | "li"; text: string } | { type: "table"; rows: string[][] };
const root = resolve(__dirname, "../..");
const md = readFileSync(resolve(root, "legal/terms-and-baa.md"), "utf8").replace(/\r\n/g, "\n");
const plain = (s: string) => s.replace(/\*\*(.+?)\*\*/g, "$1").trim();
const parts: Array<{ title: string; blocks: Block[] }> = [];
for (const chunk of md.split(/\n{2,}/)) {
  const t = chunk.trim();
  if (!t) continue;
  if (t.startsWith("# ")) { parts.push({ title: plain(t.slice(2)), blocks: [] }); continue; }
  const blocks = parts.at(-1)?.blocks;
  if (!blocks) throw new Error("Text before the first # part");
  if (t.startsWith("## ")) blocks.push({ type: "h", text: plain(t.slice(3)) });
  else if (t.startsWith("|")) {
    const rows = t.split("\n").filter((l) => !/^\|\s*-/.test(l)).map((l) => l.replace(/^\||\|$/g, "").split("|").map(plain));
    blocks.push({ type: "table", rows });
  } else if (t.startsWith("- ")) for (const l of t.split("\n")) blocks.push({ type: "li", text: plain(l.replace(/^- /, "")) });
  else blocks.push({ type: "p", text: plain(t.replace(/\n/g, " ")) });
}

const out = `/**
 * The Terms of Service and Business Associate Agreement that clients sign with their order form
 * (admin site > Contracts). GENERATED from legal/terms-and-baa.md by \`npm run contract:text\`:
 * edit that file, not this one. Every contract stores a copy of the text it was sent with, so
 * changing this never changes a contract already sent or signed.
 */

export type ContractBlock = { type: "h"; text: string } | { type: "p"; text: string } | { type: "li"; text: string } | { type: "table"; rows: string[][] };
export type ContractPart = { title: string; blocks: ContractBlock[] };

/** The company clients contract with. */
export const CONTRACT_PARTY = "HyFy Interactive LLC";

export const CONTRACT_VERSION = ${JSON.stringify(CONTRACT_VERSION)};

/** False until a lawyer has reviewed the text (scripts/contract-text.ts). */
export const CONTRACT_REVIEWED = ${REVIEWED};

export const CONTRACT_TERMS: ContractPart[] = ${JSON.stringify(parts, null, 2)};

/** True while the text hasn't been reviewed by a lawyer, or still has blanks in [brackets]. */
export const contractIsDraft = () => !CONTRACT_REVIEWED || JSON.stringify(CONTRACT_TERMS).includes("[");
`;
writeFileSync(resolve(root, "web/src/lib/contract-text.ts"), out);
console.log(`Wrote ${parts.length} parts, ${parts.reduce((a, p) => a + p.blocks.length, 0)} blocks.`);
