import Link from "next/link";
import { residentPhotoUrl } from "@/components/resident-photo";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { medicationOrders, organizations } from "@/db/schema";
import { canGiveMeds } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { getResident } from "@/server/residents";
import { prnAction } from "../../../care-actions";
import { PrnForm } from "../../../care-forms";

const safeBack = (b?: string) => (b && b.startsWith("/") && !b.startsWith("//") ? b : "/meds");

export default async function PrnPage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ back?: string }> }) {
  const { orderId } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const [o] = await tx.select().from(medicationOrders).where(eq(medicationOrders.id, orderId));
    if (!o || o.type !== "prn") return null;
    const r = await getResident(tx, actor, o.residentId);
    if (!r) return null;
    const [org] = await tx.select({ check: organizations.residentCheck }).from(organizations).where(eq(organizations.id, r.orgId));
    return { o, r, mode: org.check };
  });
  if (!data) notFound();
  const { o, r, mode } = data;
  const back = safeBack(sp.back);
  return (
    <>
      <Link href={back}>‹ Back</Link>
      <section className="card" style={{ maxWidth: 640 }}>
        <div>
          <h1>{o.name} {o.strength} <span className="pill info">As needed</span></h1>
          <p className="muted" style={{ margin: 0 }}>{r.firstName} {r.lastName} · Room {r.room} · {o.purpose} · at least {(o.prnMinIntervalMinutes ?? 0) / 60} hours apart, up to {o.prnMaxPerDay} a day</p>
        </div>
        {r.allergies.length ? <span className="allergy">Allergies: {r.allergies.join(", ")}</span> : <span className="pill ok">No known allergies</span>}
        {canGiveMeds(me) ? (
          <PrnForm action={prnAction} orderId={o.id} hasPackageCode={!!o.packageCode} reasons={o.prnReasons} label={`${o.name} ${o.strength}`} back={back} mode={mode} who={{ name: `${r.firstName} ${r.lastName}`, dateOfBirth: r.dateOfBirth, room: r.room, photo: residentPhotoUrl(r) }} />
        ) : (
          <p className="error">Only med-certified caregivers can give medications.</p>
        )}
      </section>
    </>
  );
}
