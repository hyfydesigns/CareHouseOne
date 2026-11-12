import { redirect } from "next/navigation";
import { ADMIN_PENDING_COOKIE, readAdminCookie } from "@/lib/admin-session";
import { CodeForm } from "../../../../(auth)/forms";
import { adminVerifyAction } from "../../../actions";

export default async function AdminVerifyPage() {
  if (!(await readAdminCookie(ADMIN_PENDING_COOKIE))) redirect("/admin/sign-in");
  return (
    <>
      <h1>Enter your code</h1>
      <p className="muted">Open your authenticator app and enter the 6-digit code for CareHouse One (admin).</p>
      <CodeForm action={adminVerifyAction} label="Sign in" />
    </>
  );
}
