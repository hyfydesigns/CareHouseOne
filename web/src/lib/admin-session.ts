import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { isAdminHost } from "@/lib/hosts";
import { getAdmin, type AdminUser } from "@/server/admin-auth";

export const ADMIN_COOKIE = "ch1_admin";
export const ADMIN_PENDING_COOKIE = "ch1_admin_pending";

const secure = process.env.NODE_ENV === "production";

/** Admin cookies only go to the admin site's own pages. */
export async function setAdminCookie(name: string, token: string, expires: Date): Promise<void> {
  (await cookies()).set(name, token, { httpOnly: true, secure, sameSite: "strict", path: "/admin", expires });
}

export async function clearAdminCookie(name: string): Promise<void> {
  (await cookies()).set(name, "", { httpOnly: true, secure, sameSite: "strict", path: "/admin", maxAge: 0 });
}

export async function readAdminCookie(name: string): Promise<string | undefined> {
  return (await cookies()).get(name)?.value;
}

export async function currentAdmin(): Promise<AdminUser | null> {
  // Belt and braces: the proxy already refuses /admin on other addresses.
  if (!isAdminHost((await headers()).get("host"))) return null;
  const token = await readAdminCookie(ADMIN_COOKIE);
  return token ? getAdmin(await getDb(), token) : null;
}

/** At the top of every admin page and action. */
export async function requireAdmin(): Promise<AdminUser> {
  const admin = await currentAdmin();
  if (!admin) redirect("/admin/sign-in");
  return admin;
}
