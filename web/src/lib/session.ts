import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getSessionUser, type SessionUser } from "@/server/auth";
import { resolveDevice } from "@/server/devices";

export const SESSION_COOKIE = "ch1_session";
export const PENDING_COOKIE = "ch1_pending";
/** Long-lived: marks this browser as a registered shared tablet. */
export const DEVICE_COOKIE = "ch1_device";

const secure = process.env.NODE_ENV === "production";

export async function setCookie(name: string, token: string, expires: Date): Promise<void> {
  (await cookies()).set(name, token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires });
}

export async function setDeviceCookie(token: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, token, { httpOnly: true, secure, sameSite: "strict", path: "/", maxAge: 400 * 24 * 3600 });
}

/** The registered tablet this browser is, if any (still active). */
export async function currentDevice() {
  return resolveDevice(await getDb(), await readCookie(DEVICE_COOKIE));
}

export async function clearCookie(name: string): Promise<void> {
  (await cookies()).delete(name);
}

export async function readCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = await readCookie(SESSION_COOKIE);
  if (!token) return null;
  return getSessionUser(await getDb(), token);
}

/** Signed in, but possibly locked or still needing a PIN. Only the lock and PIN pages use this. */
export async function requireSession(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Use at the top of every signed-in page and action. Locked tablets show nothing until unlocked. */
export async function requireUser(): Promise<SessionUser> {
  const user = await requireSession();
  if (user.needsPin) redirect("/pin");
  if (user.locked) redirect("/locked");
  return user;
}

/** Base URL for links in emails. Set APP_URL in production; never trust the Host header there. */
export async function appUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL is required in production");
  const h = await headers();
  return `http://${h.get("host") ?? "localhost:3000"}`;
}

/**
 * The caller's IP for rate limiting. Google's front end appends the address it saw to
 * X-Forwarded-For, so the last entry is the one a client can't forge.
 */
export async function clientIp(): Promise<string> {
  const xff = (await headers()).get("x-forwarded-for");
  const last = xff?.split(",").map((s) => s.trim()).filter(Boolean).pop();
  return last ?? "unknown";
}

export async function userAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent") ?? undefined;
}
