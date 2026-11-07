import { and, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { onboardingItems, onboardingPackets } from "@/db/schema";
import { canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { listStaffDocuments, STAFF_DOC_CATEGORIES, staffMember, type StaffDocCategory } from "@/server/staff-documents";
import { DocumentUpload, RemoveDocumentButton } from "../../residents/[id]/documents";
import { removeStaffDocumentAction } from "../actions";

/** One staff member's file: their signed onboarding forms, certificates and uploads. */
export default async function StaffFile({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireUser();
  if (!canManageCare(me)) redirect("/dashboard");
  const { id } = await params;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const person = await staffMember(tx, actor, id);
    if (!person) return null;
    const [packet] = await tx.select({ id: onboardingPackets.id }).from(onboardingPackets).where(eq(onboardingPackets.staffUserId, person.id)).orderBy(desc(onboardingPackets.createdAt)).limit(1);
    const left = packet ? await tx.select({ status: onboardingItems.status }).from(onboardingItems).where(and(eq(onboardingItems.packetId, packet.id), eq(onboardingItems.afterHire, true))) : [];
    return { person, packet, left: left.filter((i) => i.status !== "approved").length, documents: await listStaffDocuments(tx, actor, person.id) };
  });
  if (!data) notFound();
  const { person, packet, left, documents } = data;
  return (
    <>
      <div>
        <Link href="/staff" className="small">‹ Staff</Link>
        <h1>{person.name}</h1>
        <p className="muted" style={{ margin: 0 }}>{person.email}</p>
      </div>
      {packet && left > 0 && (
        <p className="notice row" style={{ margin: 0 }}>
          <span className="grow">{left} onboarding form{left === 1 ? "" : "s"} still to finish on the job.</span>
          <Link className="btn small primary" href={`/onboarding/${packet.id}`}>Open onboarding</Link>
        </p>
      )}
      <DocumentUpload url={`/api/staff/${person.id}/documents`} categories={Object.entries(STAFF_DOC_CATEGORIES)} example="CPR card" />
      {(Object.keys(STAFF_DOC_CATEGORIES) as StaffDocCategory[]).filter((c) => documents.some((d) => d.category === c)).map((c) => (
        <section key={c} className="card" aria-label={STAFF_DOC_CATEGORIES[c]}>
          <h2>{STAFF_DOC_CATEGORIES[c]}</h2>
          <div className="tablewrap">
            <table className="fit-sm">
              <tbody>
                {documents.filter((d) => d.category === c).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <a href={`/api/staff-documents/${d.id}`} target="_blank" rel="noreferrer"><b>{d.title}</b></a>
                      {d.source !== "upload" && <span className="pill info" style={{ marginLeft: 6 }}>From onboarding</span>}
                      <div className="small muted">{d.contentType === "application/pdf" ? "PDF" : "Photo"} · {(d.sizeBytes / 1024 / 1024).toFixed(1)} MB · {d.uploadedAt.toISOString().slice(0, 10)}{d.by ? ` · ${d.by}` : ""}</div>
                    </td>
                    <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                      <a className="btn small" href={`/api/staff-documents/${d.id}?download=1`}>Download</a>{" "}
                      <RemoveDocumentButton action={removeStaffDocumentAction.bind(null, d.id)} title={d.title} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
      {!documents.length && <p className="muted">No documents on file yet. Add certificates, cards and signed forms here.</p>}
      <p className="small muted" style={{ margin: 0 }}>Only owners and admins see these documents. Opening or downloading one is recorded in the audit log.</p>
    </>
  );
}
