import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { getSessionUser, type SessionUser } from "@/server/auth";

export const SESSION_COOKIE = "ch1_session";
export const PENDING_COOKIE = "ch1_pending";

const secure = process.env.NODE_ENV === "production";

export async function setCookie(name: string, token: string, expires: Date): Promise<void> {
  (await cookies()).set(name, token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires });
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

/** Use at the top of every signed-in page and action. */
export async function requireUser(): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return user;
}

/** Base URL for links in emails. Set APP_URL in production; never trust the Host header there. */
export async function appUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") throw new Error("APP_URL is required in production");
  const h = await headers();
  return `http://${h.get("host") ?? "localhost:3000"}`;
}

export async function userAgent(): Promise<string | undefined> {
  return (await headers()).get("user-agent") ?? undefined;
}
