"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { appUrl, clearCookie, clientIp, currentDevice, currentUser, PENDING_COOKIE, readCookie, requireSession, requireUser, SESSION_COOKIE, setCookie, userAgent } from "@/lib/session";
import { acceptInvite, confirmEnrollment, disableMfa, requestPasswordReset, resetPassword, signIn, signOut, verifyMfa } from "@/server/auth";
import { lockSession, setPin, unlockWithPin } from "@/server/devices";
import { deliverNow } from "@/server/mailer";
import { hit, tooMany, type LimitName } from "@/server/rate-limit";

export type FormState = { error?: string; message?: string };

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** Returns an error message when this network has made too many attempts. */
async function limited(name: LimitName): Promise<string | null> {
  const r = await hit(await getDb(), name, await clientIp());
  return r.ok ? null : tooMany(r);
}

export async function signInAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  const password = str(fd, "password");
  if (!email || !password) return { error: "Enter your email and password." };
  const busy = await limited("signIn");
  if (busy) return { error: busy };
  const device = await currentDevice();
  const r = await signIn(await getDb(), { email, password, userAgent: await userAgent(), deviceId: device?.id ?? null });
  if (!r.ok) return { error: r.error };
  // Signed in already, unless they turned on two-step verification (on a tablet, the PIN comes next).
  if (r.next === "done") return finish(r.token, r.expiresAt);
  await setCookie(PENDING_COOKIE, r.token, r.expiresAt);
  redirect("/sign-in/verify");
}

async function finish(token: string, expiresAt: Date): Promise<never> {
  await setCookie(SESSION_COOKIE, token, expiresAt);
  await clearCookie(PENDING_COOKIE);
  redirect("/dashboard");
}

export async function verifyAction(_: FormState, fd: FormData): Promise<FormState> {
  const token = await readCookie(PENDING_COOKIE);
  if (!token) redirect("/sign-in");
  const busy = await limited("twoStep");
  if (busy) return { error: busy };
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

/** Account page: turn two-step verification on with the code from the newly added app. */
export async function enableTwoStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const busy = await limited("twoStep");
  if (busy) return { error: busy };
  const r = await confirmEnrollment(await getDb(), me.id, str(fd, "code"));
  if (!r.ok) return { error: r.error };
  revalidatePath("/account");
  return { message: "Two-step verification is on. Every sign-in now asks for a code from your app." };
}

export async function disableTwoStepAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireUser();
  const busy = await limited("twoStep");
  if (busy) return { error: busy };
  const r = await disableMfa(await getDb(), me.id, str(fd, "code"));
  if (!r.ok) return { error: r.error };
  await deliverNow(await getDb());
  revalidatePath("/account");
  return { message: "Two-step verification is off." };
}

export async function forgotAction(_: FormState, fd: FormData): Promise<FormState> {
  const email = str(fd, "email");
  if (!/@/.test(email)) return { error: "Enter your work email." };
  const busy = await limited("reset");
  if (busy) return { error: busy };
  await requestPasswordReset(await getDb(), email, await appUrl());
  await deliverNow(await getDb());
  return {
    message:
      "If that email has an account, a link is on its way: a password reset (expires in 30 minutes), or a new invitation if you never finished setting up your account (expires in 7 days).",
  };
}

export async function resetAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const pw = str(fd, "password");
  if (pw !== str(fd, "confirm")) return { error: "The two passwords don't match." };
  const busy = await limited("link");
  if (busy) return { error: busy };
  const r = await resetPassword(await getDb(), token, pw);
  if (!r.ok) return { error: r.error };
  await deliverNow(await getDb());
  redirect("/sign-in?reset=1");
}

export async function acceptInviteAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const pw = str(fd, "password");
  if (pw !== str(fd, "confirm")) return { error: "The two passwords don't match." };
  const busy = await limited("link");
  if (busy) return { error: busy };
  const device = await currentDevice();
  const r = await acceptInvite(await getDb(), token, pw, await userAgent(), device?.id ?? null);
  if (!r.ok) return { error: r.error };
  if (r.next === "tablet-only") redirect("/sign-in?tablet=1");
  return finish(r.token, r.expiresAt);
}

export async function signOutAction(): Promise<void> {
  const token = await readCookie(SESSION_COOKIE);
  if (token) await signOut(await getDb(), token);
  await clearCookie(SESSION_COOKIE);
  redirect("/sign-in");
}

export async function setPinAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireSession();
  const r = await setPin(await getDb(), me, str(fd, "pin"), str(fd, "confirm"));
  if (!r.ok) return { error: r.error };
  redirect("/dashboard");
}

export async function unlockAction(_: FormState, fd: FormData): Promise<FormState> {
  const me = await requireSession();
  const busy = await limited("twoStep");
  if (busy) return { error: busy };
  const r = await unlockWithPin(await getDb(), me, str(fd, "pin"));
  if (r.ok) redirect("/dashboard");
  if (r.signedOut) {
    await clearCookie(SESSION_COOKIE);
    redirect("/sign-in?locked=1");
  }
  return { error: r.error };
}

/** Called by the tablet itself after 2 minutes without a touch; the page then reloads to the lock screen. */
export async function idleLockAction(): Promise<void> {
  const me = await currentUser();
  if (me) await lockSession(await getDb(), me);
}

/** The Lock button in the menu. */
export async function lockAction(): Promise<void> {
  const me = await currentUser();
  if (!me) redirect("/sign-in");
  await lockSession(await getDb(), me);
  redirect(me.device ? "/locked" : "/dashboard");
}
