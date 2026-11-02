import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { canManageOnboarding, getForm } from "@/server/onboarding-forms";
import { saveFormAction } from "../../actions";
import { FormEditor } from "./editor";

export default async function EditOnboardingForm({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const { id } = await params;
  const form = await withTenant(await getDb(), me.orgId, (tx) => getForm(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }, id));
  if (!form) notFound();
  return (
    <>
      <div>
        <Link href="/onboarding/forms" className="small">‹ All forms</Link>
        <h1>{form.title}</h1>
      </div>
      <FormEditor key={`${form.id}-${form.version}`} initial={{ title: form.title, description: form.description, kind: form.kind, required: form.required, blocks: form.blocks }} save={saveFormAction.bind(null, form.id)} />
    </>
  );
}
