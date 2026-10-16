import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canViewAudit } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getOrg } from "@/server/org";
import { residentCheckAction } from "./actions";
import { ResidentCheckForm } from "./settings-form";

export default async function SettingsPage() {
  const me = await requireUser();
  if (!canViewAudit(me)) redirect("/dashboard");
  const org = await withTenant(await getDb(), me.orgId, (tx) => getOrg(tx, me.orgId));
  if (!org) redirect("/dashboard");
  return (
    <>
      <div>
        <h1>Settings</h1>
        <p className="muted">{org.name}</p>
      </div>
      <ResidentCheckForm action={residentCheckAction} current={org.residentCheck} />
    </>
  );
}
