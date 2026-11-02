import "server-only";
import { cookies } from "next/headers";
import { getDb, withTenant, type Tx } from "@/db/client";
import { familySession, packetByToken } from "@/server/onboarding";

/** The family's short session after the emailed code; separate from staff sign-in. */
export const FAMILY_COOKIE = "ch1_family";

export async function setFamilyCookie(session: string, expires: Date): Promise<void> {
  (await cookies()).set(FAMILY_COOKIE, session, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires });
}

type Packet = NonNullable<Awaited<ReturnType<typeof packetByToken>>>;

/**
 * The onboarding behind a family link, and whether this browser has confirmed the code for it.
 * `run` works inside that organization only when the session is good.
 */
export async function familyContext(token: string) {
  const db = await getDb();
  const packet = await packetByToken(db, token);
  if (!packet) return { packet: null, signedIn: false as const };
  const session = (await cookies()).get(FAMILY_COOKIE)?.value;
  const signedIn = await withTenant(db, packet.orgId, (tx) => familySession(tx, packet, session));
  return { packet, signedIn };
}

/** Runs `fn` for a signed-in family, or returns null when the link or session isn't good. */
export async function asFamily<T>(token: string, fn: (tx: Tx, packet: Packet) => Promise<T>): Promise<T | null> {
  const { packet, signedIn } = await familyContext(token);
  if (!packet || !signedIn) return null;
  return withTenant(await getDb(), packet.orgId, (tx) => fn(tx, packet));
}
