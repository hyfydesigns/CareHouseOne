import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities, medicationOrders, organizations } from "@/db/schema";
import { canGiveMeds } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localTime } from "@/lib/time";
import { getResident } from "@/server/residents";
import { giveAction } from "../../../care-actions";
import { GiveForm } from "../../../care-forms";

const safeBack = (b?: string) => (b && b.startsWith("/") && !b.startsWith("//") ? b : "/meds");

export default async function GivePage({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: Promise<{ at?: string; back?: string }> }) {
  const { orderId } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const at = sp.at && !Number.isNaN(Date.parse(sp.at)) ? new Date(sp.at) : null;
  const data = at
    ? await withTenant(await getDb(), me.orgId, async (tx) => {
        const [o] = await tx.select().from(medicationOrders).where(eq(medicationOrders.id, orderId));
        if (!o) return null;
        const r = await getResident(tx, actor, o.residentId);
        if (!r) return null;
        const [home] = await tx.select().from(facilities).where(eq(facilities.id, r.facilityId));
        const [org] = await tx.select({ check: organizations.residentCheck }).from(organizations).where(eq(organizations.id, r.orgId));
        return { o, r, tz: home.timeZone, mode: org.check };
      })
    : null;
  if (!data || !at) notFound();
  const { o, r, tz, mode } = data;
  const back = safeBack(sp.back);
  return (
    <>
      <Link href={back}>‹ Back</Link>
      <section className="card" style={{ maxWidth: 640 }}>
        <div>
          <h1>{o.name} {o.strength}</h1>
          <p className="muted" style={{ margin: 0 }}>{r.firstName} {r.lastName} · Room {r.room} · {localTime(at, tz)} dose · {o.route} · {o.purpose}</p>
          {o.instructions && <p style={{ margin: "6px 0 0" }}><b>Instructions:</b> {o.instructions}</p>}
        </div>
        {r.allergies.length ? <span className="allergy">Allergies: {r.allergies.join(", ")}</span> : <span className="pill ok">No known allergies</span>}
        {canGiveMeds(me) ? (
          <GiveForm action={giveAction} orderId={o.id} scheduledFor={at.toISOString()} hasPackageCode={!!o.packageCode} bpCheck={o.bpCheck} label={`${o.name} ${o.strength}`} back={back} mode={mode} who={{ name: `${r.firstName} ${r.lastName}`, dateOfBirth: r.dateOfBirth, room: r.room }} />
        ) : (
          <p className="error">Only nurses and med-certified caregivers can give medications.</p>
        )}
      </section>
    </>
  );
}
