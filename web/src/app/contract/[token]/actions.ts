"use server";

import { getDb } from "@/db/client";
import { appBaseUrl } from "@/lib/hosts";
import { clientIp, userAgent } from "@/lib/session";
import { signContract } from "@/server/contracts";
import { deliverNow } from "@/server/mailer";
import { hit, tooMany } from "@/server/rate-limit";

/** The client signs their contract from the emailed link. Returns an error message, or null. */
export async function signContractAction(token: string, input: { name: string; title: string; method: "drawn" | "typed"; image?: string; consent: boolean }): Promise<string | null> {
  const db = await getDb();
  const ip = await clientIp();
  const limit = await hit(db, "link", ip);
  if (!limit.ok) return tooMany(limit);
  const r = await signContract(db, String(token), input, { ip, userAgent: await userAgent(), appUrl: appBaseUrl() });
  if (!r.ok) return r.error;
  await deliverNow(db);
  return null;
}
