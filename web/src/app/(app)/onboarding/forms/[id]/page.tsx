import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { canManageOnboarding, getForm } from "@/server/onboarding-forms";
import { printHomes } from "@/server/onboarding";
import { PrintBlankLink, PrintHomeProvider, PrintHomeSelect } from "../print-home";
import { saveFormAction } from "../../actions";
import { FormEditor } from "./editor";

export default async function EditOnboardingForm({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const { id } = await params;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const { form, homes } = await withTenant(await getDb(), me.orgId, async (tx) => ({ form: await getForm(tx, actor, id), homes: await printHomes(tx, actor, me.orgId) }));
  if (!form) notFound();
  return (
    <>
      <div>
        <Link href={`/onboarding/forms${form.audience === "staff" ? "?for=staff" : ""}`} className="small">‹ All forms</Link>
        <div className="row">
          <h1>{form.title}</h1>
          <span className="spacer" />
          {form.kind === "form" && (
            <PrintHomeProvider homes={homes}>
              <div className="row" style={{ gap: 8 }}>
                <PrintHomeSelect />
                <PrintBlankLink formId={form.id} label="Print a blank copy" />
              </div>
            </PrintHomeProvider>
          )}
        </div>
        {form.kind === "form" && <p className="small muted" style={{ margin: 0 }}>Print uses the last saved version. Save your changes first.</p>}
      </div>
      <FormEditor key={`${form.id}-${form.version}`} initial={{ title: form.title, description: form.description, kind: form.kind, required: form.required, afterHire: form.afterHire, blocks: form.blocks }} audience={form.audience} save={saveFormAction.bind(null, form.id)} />
    </>
  );
}
