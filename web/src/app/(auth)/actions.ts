"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { appUrl, clearCookie, PENDING_COOKIE, readCookie, SESSION_COOKIE, setCookie, userAgent } from "@/lib/session";
import { acceptInvite, confirmEnrollment, requestPasswordReset, resetPassword, signIn, signOut, verifyMfa } from "@/server/auth";

export type FormState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  const password = str(fd, "password");
  if (!email || !password) return { error: "Enter your email and password." };
  const r = await signIn(await getDb(), { email, password, userAgent: await userAgent() });
  if (!r.ok) return { error: r.error };
  await setCookie(PENDING_COOKIE, r.token, r.expiresAt);
  redirect(r.next === "mfa" ? "/sign-in/verify" : "/sign-in/setup");
}

async function finish(token: string, expiresAt: Date): Promise<never> {
  await setCookie(SESSION_COOKIE, token, expiresAt);
  await clearCookie(PENDING_COOKIE);
  redirect("/dashboard");
}

export async function verifyAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await readCookie(PENDING_COOKIE);
  if (!token) redirect("/sign-in");
  const r = await verifyMfa(await getDb(), token, str(fd, "code"));
  if (!r.ok) {
    if (r.restart) {
      await clearCookie(PENDING_COOKIE);
      return { error: `${r.error} Go back to sign in.` };
    }
    return { error: r.error };
  }
  return finish(token, r.expiresAt);
}

export async function confirmSetupAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await readCookie(PENDING_COOKIE);
  if (!token) redirect("/sign-in");
  const r = await confirmEnrollment(await getDb(), token, str(fd, "code"));
  if (!r.ok) return { error: r.error };
  return finish(token, r.expiresAt);
}

export async function forgotAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  if (!/@/.test(email)) return { error: "Enter your work email." };
  await requestPasswordReset(await getDb(), email, await appUrl());
  return { message: "If an account exists for that email, a reset link is on its way. It works once and expires in 30 minutes." };
}

export async function resetAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const pw = str(fd, "password");
  if (pw !== str(fd, "confirm")) return { error: "The two passwords don't match." };
  const r = await resetPassword(await getDb(), token, pw);
  if (!r.ok) return { error: r.error };
  redirect("/sign-in?reset=1");
}

export async function acceptInviteAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const pw = str(fd, "password");
  if (pw !== str(fd, "confirm")) return { error: "The two passwords don't match." };
  const r = await acceptInvite(await getDb(), token, pw, await userAgent());
  if (!r.ok) return { error: r.error };
  await setCookie(PENDING_COOKIE, r.token, r.expiresAt);
  redirect("/sign-in/setup");
}

export async function signOutAction(): Promise<void> {
  const token = await readCookie(SESSION_COOKIE);
  if (token) await signOut(await getDb(), token);
  await clearCookie(SESSION_COOKIE);
  redirect("/sign-in");
}
