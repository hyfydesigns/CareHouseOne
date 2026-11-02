"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/status";
import { getDb, withTenant } from "@/db/client";
import { asFamily, setFamilyCookie } from "@/lib/family-session";
import { clientIp, userAgent } from "@/lib/session";
import { familyRemoveFile, familySaveValues, familySign, familySubmit, packetByToken, sendCode, verifyCode } from "@/server/onboarding";
import { demoMode } from "@/server/demo";
import { hit } from "@/server/rate-limit";

const gone: FormState = { error: "Your session has ended. Reload the page and confirm the code again." };
const done = (token: string, r: { ok: true; message: string } | { ok: false; error: string }): FormState => {
  revalidatePath(`/family/${token}`);
  return r.ok ? { message: r.message } : { error: r.error };
};

export async function sendCodeAction(token: string): Promise<FormState> {
  const db = await getDb();
  const limited = await hit(db, "link", await clientIp());
  if (!limited.ok) return { error: `Too many tries. Wait ${limited.retryAfterMinutes} minutes and try again.` };
  const packet = await packetByToken(db, token);
  if (!packet) return { error: "This link has expired or was replaced. Ask the home to send a new one." };
  const r = await withTenant(db, packet.orgId, (tx) => sendCode(tx, packet));
  if (!r.ok) return { error: r.error };
  return { message: demoMode() ? `Demo: emails aren't sent, so here is the code: ${r.data!.code}` : r.message };
}

export async function verifyCodeAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limited = await hit(db, "link", await clientIp());
  if (!limited.ok) return { error: `Too many tries. Wait ${limited.retryAfterMinutes} minutes and try again.` };
  const packet = await packetByToken(db, token);
  if (!packet) return { error: "This link has expired or was replaced. Ask the home to send a new one." };
  const r = await withTenant(db, packet.orgId, (tx) => verifyCode(tx, packet, fd.get("code")));
  if (!r.ok) return { error: r.error };
  await setFamilyCookie(r.data!.session, r.data!.expires);
  revalidatePath(`/family/${token}`);
  return { message: r.message };
}

export async function saveAction(token: string, itemId: string, values: Record<string, string>): Promise<FormState> {
  const r = await asFamily(token, (tx, p) => familySaveValues(tx, p, itemId, values));
  return r ? done(token, r) : gone;
}

export async function signAction(token: string, itemId: string, blockId: string, sig: { name: string; method: string; image?: string; consent: boolean }): Promise<FormState> {
  const meta = { ip: await clientIp(), userAgent: await userAgent() };
  const r = await asFamily(token, (tx, p) => familySign(tx, p, itemId, blockId, sig, meta));
  return r ? done(token, r) : gone;
}

export async function submitAction(token: string, itemId: string): Promise<FormState> {
  const r = await asFamily(token, (tx, p) => familySubmit(tx, p, itemId));
  return r ? done(token, r) : gone;
}

export async function removeFileAction(token: string, fileId: string): Promise<FormState> {
  const r = await asFamily(token, (tx, p) => familyRemoveFile(tx, p, fileId));
  return r ? done(token, r) : gone;
}
