"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { currentDevice, readCookie, SESSION_COOKIE, setCookie, setDeviceCookie, userAgent } from "@/lib/session";
import { demoSignIn, signOut } from "@/server/auth";
import { DEMO_ROLES, demoIsStale, demoMode, registerDemoTablet, resetDemo, type DemoRole } from "@/server/demo";

/** One click into the demo as the owner, or as the caregiver on a home tablet. */
export async function demoSignInAction(role: DemoRole): Promise<void> {
  if (!demoMode() || !(role in DEMO_ROLES)) redirect("/sign-in");
  const db = await getDb();
  // Each new visit after a quiet spell starts from fresh made-up data.
  if (await demoIsStale(db)) await resetDemo(db);
  const old = await readCookie(SESSION_COOKIE);
  if (old) await signOut(db, old);
  let deviceId: string | null = null;
  if (role === "caregiver") {
    // Caregivers only work on a home tablet: make this browser one (as an owner would in Settings).
    const existing = await currentDevice();
    if (existing) deviceId = existing.id;
    else {
      const tablet = await registerDemoTablet(db);
      await setDeviceCookie(tablet.token);
      deviceId = tablet.id;
    }
  }
  const s = await demoSignIn(db, DEMO_ROLES[role].email, deviceId, await userAgent());
  await setCookie(SESSION_COOKIE, s.token, s.expiresAt);
  redirect(role === "caregiver" ? "/meds" : "/dashboard");
}
