import { asc, count, eq, max } from "drizzle-orm";
import type { Tx } from "@/db/client";
import { onboardingForms } from "@/db/schema";
import { asAudience, blockSchema, formSchema, newBlockId, type Audience, type Block, type FormKind } from "@/lib/onboarding-forms";
import { canManageCare, type Actor } from "@/lib/permissions";
import { audit } from "./audit";
import { staffStarterForms } from "./onboarding-staff-starters";
import { starterForms } from "./onboarding-starters";
import type { Result } from "./residents";

export const canManageOnboarding = (actor: Pick<Actor, "role">) => canManageCare(actor as Actor);

export interface OnboardingForm {
  id: string;
  title: string;
  description: string;
  kind: FormKind;
  required: boolean;
  audience: Audience;
  afterHire: boolean;
  blocks: Block[];
  position: number;
  version: number;
  hidden: boolean;
  updatedAt: Date;
}

/** Stored blocks are checked on the way out too; anything unreadable is dropped, never shown. */
function toForm(r: typeof onboardingForms.$inferSelect): OnboardingForm {
  const blocks = (r.blocks ?? []).flatMap((b) => {
    const p = blockSchema.safeParse(b);
    return p.success ? [p.data as Block] : [];
  });
  return { id: r.id, title: r.title, description: r.description, kind: r.kind === "upload" ? "upload" : "form", required: r.required, audience: asAudience(r.audience), afterHire: r.afterHire, blocks, position: r.position, version: r.version, hidden: !!r.hiddenAt, updatedAt: r.updatedAt ?? r.createdAt };
}

const startersFor = (audience: Audience): Array<ReturnType<typeof staffStarterForms>[number]> => (audience === "staff" ? staffStarterForms() : starterForms());

/** The first time an organization opens onboarding, it gets the starter forms to edit. */
export async function ensureStarterForms(tx: Tx, orgId: string, actorId: string | null, audience: Audience = "resident"): Promise<void> {
  const [{ n }] = await tx.select({ n: count() }).from(onboardingForms).where(eq(onboardingForms.audience, audience));
  if (n > 0) return;
  const [{ top }] = await tx.select({ top: max(onboardingForms.position) }).from(onboardingForms);
  await tx.insert(onboardingForms).values(startersFor(audience).map((f, i) => ({ orgId, title: f.title, description: f.description, kind: f.kind, required: f.required, audience, afterHire: !!f.afterHire, blocks: f.blocks, position: (top ?? 0) + i + 1, createdBy: actorId })));
}

export async function listForms(tx: Tx, actor: Actor, opts: { includeHidden?: boolean; audience?: Audience } = {}): Promise<OnboardingForm[]> {
  if (!canManageOnboarding(actor)) return [];
  const rows = await tx.select().from(onboardingForms).where(eq(onboardingForms.audience, opts.audience ?? "resident")).orderBy(asc(onboardingForms.position));
  return rows.map(toForm).filter((f) => opts.includeHidden || !f.hidden);
}

export async function getForm(tx: Tx, actor: Actor, id: string): Promise<OnboardingForm | null> {
  if (!canManageOnboarding(actor) || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [r] = await tx.select().from(onboardingForms).where(eq(onboardingForms.id, id));
  return r ? toForm(r) : null;
}

/** A new form at the end of the list, ready to edit. */
export async function createForm(tx: Tx, actor: Actor, orgId: string, kind: FormKind, audience: Audience = "resident"): Promise<Result<{ id: string }>> {
  if (!canManageOnboarding(actor)) return { ok: false, error: "Only owners and admins manage onboarding forms." };
  await ensureStarterForms(tx, orgId, actor.id, audience);
  const [{ top }] = await tx.select({ top: max(onboardingForms.position) }).from(onboardingForms);
  const blocks: Block[] = kind === "form" ? [{ id: newBlockId(), type: "field", label: "Your question", input: "text", required: true, who: "poa" }, { id: newBlockId(), type: "signature", label: audience === "staff" ? "Employee" : "Responsible party", who: "poa" }] : [];
  const [row] = await tx
    .insert(onboardingForms)
    .values({ orgId, title: kind === "form" ? "New form" : "New document request", description: "", kind, required: true, audience, blocks, position: (top ?? 0) + 1, createdBy: actor.id })
    .returning({ id: onboardingForms.id });
  await audit(tx, { orgId, actorId: actor.id, action: "onboarding_form_added", entity: "organization", entityId: orgId, details: { formId: row.id, kind } });
  return { ok: true, message: "Form added.", data: { id: row.id } };
}

/** Saves an edited form. Onboardings already sent keep the version they were sent with. */
export async function saveForm(tx: Tx, actor: Actor, id: string, raw: unknown, now = new Date()): Promise<Result> {
  const form = await getForm(tx, actor, id);
  if (!form) return { ok: false, error: "That form isn't available." };
  const p = formSchema.safeParse(raw);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const blocks = p.data.kind === "upload" ? [] : p.data.blocks;
  await tx
    .update(onboardingForms)
    .set({ title: p.data.title, description: p.data.description, kind: p.data.kind, required: p.data.required, afterHire: form.audience === "staff" && !!p.data.afterHire, blocks, version: form.version + 1, updatedBy: actor.id, updatedAt: now })
    .where(eq(onboardingForms.id, id));
  const [{ orgId }] = await tx.select({ orgId: onboardingForms.orgId }).from(onboardingForms).where(eq(onboardingForms.id, id));
  await audit(tx, { orgId, actorId: actor.id, action: "onboarding_form_saved", entity: "organization", entityId: orgId, details: { formId: id, title: p.data.title, version: form.version + 1 } });
  return { ok: true, message: `${p.data.title} saved.` };
}

/** Hide a form the home no longer uses (or show it again). */
export async function setFormHidden(tx: Tx, actor: Actor, id: string, hidden: boolean, now = new Date()): Promise<Result> {
  const form = await getForm(tx, actor, id);
  if (!form) return { ok: false, error: "That form isn't available." };
  await tx.update(onboardingForms).set({ hiddenAt: hidden ? now : null }).where(eq(onboardingForms.id, id));
  return { ok: true, message: hidden ? `${form.title} hidden. It won't be offered for new onboardings.` : `${form.title} will be offered for new onboardings again.` };
}

/** Move a form one place up or down in the checklist. */
export async function moveForm(tx: Tx, actor: Actor, id: string, dir: -1 | 1): Promise<Result> {
  const form = await getForm(tx, actor, id);
  const forms = await listForms(tx, actor, { includeHidden: true, audience: form?.audience });
  const i = forms.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= forms.length) return { ok: true, message: "" };
  await tx.update(onboardingForms).set({ position: forms[j].position }).where(eq(onboardingForms.id, forms[i].id));
  await tx.update(onboardingForms).set({ position: forms[i].position }).where(eq(onboardingForms.id, forms[j].id));
  return { ok: true, message: "Moved." };
}

/** Starter forms this organization doesn't have yet (by title), for organizations that started earlier. */
export async function missingStarters(tx: Tx, actor: Actor, audience: Audience = "resident"): Promise<string[]> {
  const have = new Set((await listForms(tx, actor, { includeHidden: true, audience })).map((f) => f.title.toLowerCase()));
  return startersFor(audience).filter((f) => !have.has(f.title.toLowerCase())).map((f) => f.title);
}

/** Adds the starter forms the organization doesn't have yet, at the end of the list. */
export async function addMissingStarters(tx: Tx, actor: Actor, orgId: string, audience: Audience = "resident"): Promise<Result> {
  if (!canManageOnboarding(actor)) return { ok: false, error: "Only owners and admins manage onboarding forms." };
  const missing = new Set(await missingStarters(tx, actor, audience));
  const add = startersFor(audience).filter((f) => missing.has(f.title));
  if (!add.length) return { ok: true, message: "You already have every starter form." };
  const [{ top }] = await tx.select({ top: max(onboardingForms.position) }).from(onboardingForms);
  await tx.insert(onboardingForms).values(add.map((f, i) => ({ orgId, title: f.title, description: f.description, kind: f.kind, required: f.required, audience, afterHire: !!f.afterHire, blocks: f.blocks, position: (top ?? 0) + i + 1, createdBy: actor.id })));
  await audit(tx, { orgId, actorId: actor.id, action: "onboarding_form_added", entity: "organization", entityId: orgId, details: { starters: add.map((f) => f.title) } });
  return { ok: true, message: `Added: ${add.map((f) => f.title).join(", ")}.` };
}
