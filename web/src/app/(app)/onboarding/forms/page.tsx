import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { FORM_KINDS } from "@/lib/onboarding-forms";
import { requireUser } from "@/lib/session";
import { canManageOnboarding, ensureStarterForms, listForms, missingStarters } from "@/server/onboarding-forms";
import { addStartersAction, createFormAction, hideFormAction, moveFormAction } from "../actions";

/** The checklist every new family gets: forms to fill and sign, and documents to upload. */
export default async function OnboardingFormsPage() {
  const me = await requireUser();
  if (!canManageOnboarding(me)) redirect("/dashboard");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const { forms, missing } = await withTenant(await getDb(), me.orgId, async (tx) => {
    await ensureStarterForms(tx, me.orgId, me.id);
    return { forms: await listForms(tx, actor, { includeHidden: true }), missing: await missingStarters(tx, actor) };
  });
  const shown = forms.filter((f) => !f.hidden);
  return (
    <>
      <div>
        <Link href="/onboarding" className="small">‹ Onboarding</Link>
        <h1>Onboarding forms</h1>
        <p className="muted" style={{ margin: 0 }}>
          What every new family is asked for, in this order. The starter forms are general examples: read them, change the wording to your home&apos;s own, and add your forms before sending them to a family.
        </p>
      </div>
      {missing.length > 0 && (
        <form action={addStartersAction} className="notice row" style={{ margin: 0 }}>
          <span className="grow">New starter forms are available: <b>{missing.join(", ")}</b>. Adding them puts them at the end of your list; hide any you don&apos;t use.</span>
          <button className="btn small primary">Add them</button>
        </form>
      )}
      <section className="card">
        <div className="tablewrap">
          <table className="fit-sm">
            <tbody>
              {forms.map((f) => {
                const i = shown.findIndex((x) => x.id === f.id);
                return (
                  <tr key={f.id}>
                    <td>
                      <Link href={`/onboarding/forms/${f.id}`}><b className={f.hidden ? "muted" : undefined}>{f.title}</b></Link>
                      <div className="small muted">
                        {FORM_KINDS[f.kind]}{f.required ? " · required" : " · optional"}{f.hidden ? " · hidden" : ""}
                        {f.kind === "form" ? ` · ${f.blocks.filter((b) => b.type === "signature").length} signature line(s)` : ""}
                      </div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      {!f.hidden && (
                        <>
                          <form action={moveFormAction.bind(null, f.id, -1)} style={{ display: "inline" }}><button className="btn small" disabled={i === 0} aria-label={`Move ${f.title} up`}>↑</button></form>{" "}
                          <form action={moveFormAction.bind(null, f.id, 1)} style={{ display: "inline" }}><button className="btn small" disabled={i === shown.length - 1} aria-label={`Move ${f.title} down`}>↓</button></form>{" "}
                        </>
                      )}
                      <Link className="btn small" href={`/onboarding/forms/${f.id}`}>Edit</Link>{" "}
                      <form action={hideFormAction.bind(null, f.id, !f.hidden)} style={{ display: "inline" }}><button className="btn small">{f.hidden ? "Show" : "Hide"}</button></form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row">
          <form action={createFormAction.bind(null, "form")}><button className="btn primary">+ Add a form</button></form>
          <form action={createFormAction.bind(null, "upload")}><button className="btn">+ Ask for a document</button></form>
        </div>
      </section>
    </>
  );
}
