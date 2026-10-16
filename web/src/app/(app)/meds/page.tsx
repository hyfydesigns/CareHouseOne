import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canGiveMeds } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localTime } from "@/lib/time";
import { medicationPass } from "@/server/meds";
import { visibleFacilities } from "@/server/residents";
import { followupAction } from "../care-actions";
import { FollowupForm } from "../care-forms";
import { SlotRow } from "./slot-row";

export default async function MedsPage({ searchParams }: { searchParams: Promise<{ home?: string }> }) {
  const me = await requireUser();
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const sp = await searchParams;
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await visibleFacilities(tx, actor);
    const home = homes.find((h) => h.id === sp.home) ?? homes[0];
    if (!home) return null;
    return { homes, home, pass: (await medicationPass(tx, actor, home.id, now)) ?? [] };
  });
  if (!data) redirect("/dashboard");
  const { homes, home, pass } = data;
  const give = canGiveMeds(me);
  const back = `/meds?home=${home.id}`;
  const due = pass.reduce((n, p) => n + p.slots.filter((s) => s.state === "due" || s.state === "late").length, 0);
  return (
    <>
      <div className="row">
        <h1>Medication pass</h1>
        <span className="muted">{home.name} · {localTime(now, home.timeZone)} · {due} dose{due === 1 ? "" : "s"} due</span>
      </div>
      {homes.length > 1 && (
        <nav className="chips" aria-label="Homes">
          {homes.map((h) => <Link key={h.id} className="chip" href={`/meds?home=${h.id}`} aria-current={h.id === home.id ? "page" : undefined}>{h.name}</Link>)}
        </nav>
      )}
      {!give && <p className="notice">You can see the medication pass, but only nurses and med-certified caregivers can give medications.</p>}
      {pass.length === 0 && <p className="muted">No residents at this home yet.</p>}
      {pass.map(({ resident: r, slots, prnOrders, openFollowups }) => {
        const shown = slots.filter((s) => s.state !== "upcoming");
        const later = slots.length - shown.length;
        return (
          <section key={r.id} className="card" aria-labelledby={`r-${r.id}`}>
            <div className="row">
              <h2 id={`r-${r.id}`} style={{ fontSize: 17, textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}>
                <Link href={`/residents/${r.id}`}>{r.firstName} {r.lastName}</Link> <span className="muted small">Room {r.room}</span>
              </h2>
              <span className="spacer" />
              {r.allergies.length > 0 && <span className="allergy small">Allergies: {r.allergies.join(", ")}</span>}
            </div>
            {openFollowups.map((f) => (
              <div key={f.id} className="dose">
                <span><b>Check how it worked:</b> {f.medication}<br />{f.dueAt < now ? <span className="pill crit">Overdue since {localTime(f.dueAt, home.timeZone)}</span> : <span className="small muted">Due at {localTime(f.dueAt, home.timeZone)}</span>}</span>
                <FollowupForm action={followupAction} followupId={f.id} residentId={r.id} />
              </div>
            ))}
            {shown.map((s) => <SlotRow key={`${s.order.id}${s.time}`} slot={s} tz={home.timeZone} canGive={give} back={back} />)}
            {later > 0 && <p className="small muted">{later} later today</p>}
            {prnOrders.map((o) => (
              <div key={o.id} className="dose">
                <span><b>{o.name}</b> {o.strength} <span className="pill info">As needed</span><br /><span className="small muted">{o.prnReasons.join(", ")}</span></span>
                {give && <Link className="btn" href={`/meds/as-needed/${o.id}?back=${encodeURIComponent(back)}`}>Give as needed</Link>}
              </div>
            ))}
            {!shown.length && !prnOrders.length && !openFollowups.length && <p className="small muted">Nothing due right now.</p>}
          </section>
        );
      })}
    </>
  );
}
