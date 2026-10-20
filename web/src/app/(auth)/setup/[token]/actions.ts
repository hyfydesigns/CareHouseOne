"use server";

import type { FormState } from "@/components/status";
import { getDb } from "@/db/client";
import { appUrl, clientIp } from "@/lib/session";
import { completeSetup, resendSetupLink } from "@/server/billing";
import { deliverNow } from "@/server/mailer";
import { hit, tooMany } from "@/server/rate-limit";

export async function setupAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limit = await hit(db, "link", await clientIp());
  if (!limit.ok) return { error: tooMany(limit) };
  const names = fd.getAll("homeName").map(String);
  const zones = fd.getAll("homeTz").map(String);
  const beds = fd.getAll("homeBeds").map((b) => Number(b) || 0);
  const homes = names.map((name, i) => ({ name, timeZone: zones[i], beds: beds[i] })).filter((h) => h.name.trim());
  if (!homes.length) return { error: "Add at least one home." };
  const r = await completeSetup(
    db,
    token,
    { orgName: fd.get("orgName"), homes, owner: { name: fd.get("ownerName"), email: fd.get("ownerEmail") }, accepted: fd.get("accepted") === "on" },
    await appUrl(),
  );
  if (!r.ok) return { error: r.error.startsWith("[") ? "Check the details and try again." : r.error };
  await deliverNow(db);
  return { message: `Done. We've emailed ${r.email} a link to set your password and two-step verification. It expires in 7 days.` };
}

/** "Send me a new setup link" on an expired setup page. Same answer whether or not there's a sign-up. */
export async function resendSetupAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = String(fd.get("email") ?? "");
  if (!/@/.test(email)) return { error: "Enter the email on your PayPal account." };
  const db = await getDb();
  const limit = await hit(db, "reset", await clientIp());
  if (!limit.ok) return { error: tooMany(limit) };
  await resendSetupLink(db, email, await appUrl());
  await deliverNow(db);
  return { message: "If there's an unfinished sign-up for that email, a new setup link is on its way. It expires in 7 days." };
}
