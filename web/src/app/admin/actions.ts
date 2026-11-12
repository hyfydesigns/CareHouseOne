"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/status";
import { getDb } from "@/db/client";
import { ADMIN_COOKIE, ADMIN_PENDING_COOKIE, clearAdminCookie, readAdminCookie, requireAdmin, setAdminCookie } from "@/lib/admin-session";
import { appBaseUrl } from "@/lib/hosts";
import { clientIp, userAgent } from "@/lib/session";
import { adminLog, adminSignIn, adminSignOut, adminVerify, completeAdminSetup } from "@/server/admin-auth";
import { createClient, resendOwnerInvite, updateLead } from "@/server/admin";
import { cancelBilling, markInvoicePaid, refreshFromPaypal, remindInvoice, setBillingEmail, startInvoiceBilling, waiveLateFee } from "@/server/billing";
import { remindContract, sendContract, voidContract } from "@/server/contracts";
import { deliverNow } from "@/server/mailer";
import { hit, tooMany } from "@/server/rate-limit";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

// ---------------------------------------------------------------- signing in

export async function adminSignInAction(_: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limit = await hit(db, "signIn", `admin:${await clientIp()}`);
  if (!limit.ok) return { error: tooMany(limit) };
  const r = await adminSignIn(db, str(fd, "email"), str(fd, "password"), await userAgent());
  if (!r.ok) return { error: r.error };
  await setAdminCookie(ADMIN_PENDING_COOKIE, r.token, r.expiresAt);
  redirect("/admin/sign-in/verify");
}

export async function adminVerifyAction(_: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limit = await hit(db, "twoStep", `admin:${await clientIp()}`);
  if (!limit.ok) return { error: tooMany(limit) };
  const token = await readAdminCookie(ADMIN_PENDING_COOKIE);
  if (!token) redirect("/admin/sign-in");
  const r = await adminVerify(db, token, str(fd, "code"));
  if (!r.ok) {
    if (r.restart) {
      await clearAdminCookie(ADMIN_PENDING_COOKIE);
      redirect("/admin/sign-in");
    }
    return { error: r.error };
  }
  await clearAdminCookie(ADMIN_PENDING_COOKIE);
  await setAdminCookie(ADMIN_COOKIE, token, r.expiresAt);
  redirect("/admin");
}

export async function adminSetupAction(token: string, _: FormState, fd: FormData): Promise<FormState> {
  const db = await getDb();
  const limit = await hit(db, "reset", `admin:${await clientIp()}`);
  if (!limit.ok) return { error: tooMany(limit) };
  if (str(fd, "password") !== str(fd, "confirm")) return { error: "The two passwords don't match." };
  const r = await completeAdminSetup(db, token, str(fd, "password"), str(fd, "code"));
  if (!r.ok) return { error: r.error };
  redirect("/admin/sign-in?setup=1");
}

export async function adminSignOutAction(): Promise<void> {
  const token = await readAdminCookie(ADMIN_COOKIE);
  if (token) await adminSignOut(await getDb(), token);
  await clearAdminCookie(ADMIN_COOKIE);
  redirect("/admin/sign-in");
}

// ---------------------------------------------------------------- clients

export async function createClientAction(_: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const homes = str(fd, "homes")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((name) => ({ name, timeZone: str(fd, "timeZone") || "America/Chicago", beds: 0 }));
  if (!homes.length) return { error: "Add at least one home." };
  const r = await createClient(
    db,
    admin.id,
    { orgName: str(fd, "orgName"), homes, owner: { name: str(fd, "ownerName"), email: str(fd, "ownerEmail") } },
    appBaseUrl(),
    str(fd, "leadId") || null,
    { holdInvite: str(fd, "invite") !== "now" },
  );
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  redirect(`/admin/clients/${r.orgId}?created=1`);
}

export async function resendOwnerInviteAction(orgId: string, userId: string): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = await resendOwnerInvite(db, admin.id, orgId, userId, appBaseUrl());
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  return { message: `Invitation sent to ${r.email}.` };
}

// ---------------------------------------------------------------- billing

export async function startBillingAction(orgId: string, _: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = await startInvoiceBilling(db, orgId, { billingEmail: str(fd, "billingEmail"), startsOn: str(fd, "startsOn"), introMonths: Number(str(fd, "introMonths")) });
  if (!r.ok) return { error: r.error };
  await adminLog(db, { adminId: admin.id, orgId, action: "billing_started", entity: "subscription", entityId: r.subscription.id, details: { startsOn: str(fd, "startsOn"), introMonths: Number(str(fd, "introMonths")) } });
  revalidatePath(`/admin/clients/${orgId}`);
  return { message: "Billing by PayPal invoice is set up." };
}

export async function billingEmailAction(orgId: string, _: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = await setBillingEmail(db, orgId, str(fd, "billingEmail"));
  if (!r.ok) return { error: r.error };
  await adminLog(db, { adminId: admin.id, orgId, action: "billing_email_changed", entity: "subscription", details: { to: str(fd, "billingEmail") } });
  revalidatePath(`/admin/clients/${orgId}`);
  return { message: "Saved. The next invoice goes to the new address." };
}

export async function cancelBillingAction(orgId: string, _: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  if (str(fd, "confirm") !== "cancel") return { error: 'Type "cancel" to confirm.' };
  const r = await cancelBilling(db, orgId, str(fd, "reason"));
  if (!r.ok) return { error: r.error };
  await adminLog(db, { adminId: admin.id, orgId, action: "billing_cancelled", entity: "subscription", details: { reason: str(fd, "reason").slice(0, 200) } });
  await deliverNow(db);
  revalidatePath(`/admin/clients/${orgId}`);
  return { message: "Billing is cancelled. The current cycle is the last one billed." };
}

export async function refreshPaypalAction(orgId: string): Promise<FormState> {
  await requireAdmin();
  try {
    await refreshFromPaypal(await getDb(), orgId);
  } catch (e) {
    return { error: `PayPal didn't answer: ${(e as Error).message}` };
  }
  revalidatePath(`/admin/clients/${orgId}`);
  return { message: "Updated from PayPal." };
}

export async function invoiceAction(invoiceId: string, op: "paid" | "waive" | "remind", path: string, note = ""): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = op === "paid" ? await markInvoicePaid(db, invoiceId, note) : op === "waive" ? await waiveLateFee(db, invoiceId) : await remindInvoice(db, invoiceId);
  if (!r.ok) return { error: r.error };
  await adminLog(db, { adminId: admin.id, action: `invoice_${op}`, entity: "billing_invoice", entityId: invoiceId, details: note ? { note: note.slice(0, 200) } : {} });
  revalidatePath(path);
  return { message: op === "paid" ? "Marked paid." : op === "waive" ? "Late fee waived." : "PayPal is sending a reminder." };
}

// ---------------------------------------------------------------- contracts

export async function sendContractAction(orgId: string, _: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = await sendContract(db, admin.id, orgId, Object.fromEntries(["signerName", "signerEmail", "homes", "startsOn", "introMonths", "note"].map((k) => [k, str(fd, k)])), appBaseUrl());
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  revalidatePath(`/admin/clients/${orgId}`);
  return { message: "Sent. The signer has an email with their link." };
}

export async function contractAction(id: string, op: "remind" | "void", path: string): Promise<FormState> {
  const admin = await requireAdmin();
  const db = await getDb();
  const r = op === "remind" ? await remindContract(db, admin.id, id, appBaseUrl()) : await voidContract(db, admin.id, id);
  if (!r.ok) return { error: r.error };
  await deliverNow(db);
  revalidatePath(path);
  return { message: op === "remind" ? "A new link is on its way to the signer (the old one no longer works)." : "Withdrawn. The link no longer works." };
}

// ---------------------------------------------------------------- leads

export async function leadAction(id: string, _: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const r = await updateLead(await getDb(), admin.id, id, { status: str(fd, "status"), notes: str(fd, "notes") });
  if (!r.ok) return { error: r.error };
  revalidatePath("/admin/leads");
  return { message: "Saved." };
}
