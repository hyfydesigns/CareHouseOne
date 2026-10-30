import Link from "next/link";
import { Icon } from "@/components/icon";
import { ResidentPhoto, residentPhotoUrl } from "@/components/resident-photo";
import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canGiveMeds } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { localClock } from "@/lib/time";
import { SHIFT_LABEL, shiftHomes, shiftStatus } from "@/server/care";
import { upcomingAppointments } from "@/server/appointments";
import { recentHandoffs } from "@/server/operations";
import { medCertExpired } from "@/server/training";
import { localDate } from "@/lib/time";
import { medicationPass } from "@/server/meds";
import { visibleFacilities } from "@/server/residents";
import { followupAction } from "../care-actions";
import { FollowupForm } from "../care-forms";
import { SlotRow } from "./slot-row";
import { ShiftGate } from "../care/shift-gate";

export default async function MedsPage({ searchParams }: { searchParams: Promise<{ home?: string }> }) {
  const me = await requireUser();
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const sp = await searchParams;
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await visibleFacilities(tx, actor);
    // The home picked, else the home of the person's shift, else the tablet's first home they work at.
    const shiftHome = (await shiftStatus(tx, actor))?.facilityId ?? shiftHomes(actor, me.device?.facilityIds)[0];
    const home = homes.find((h) => h.id === sp.home) ?? homes.find((h) => h.id === shiftHome) ?? homes[0];
    if (!home) return null;
    const today = localDate(now, home.timeZone);
    const appts = (await upcomingAppointments(tx, actor, [home.id], now, 1)).filter((x) => localDate(x.a.scheduledAt, home.timeZone) === today);
    return {
      homes,
      home,
      pass: (await medicationPass(tx, actor, home.id, now)) ?? [],
      handoff: (await recentHandoffs(tx, actor, home.id, now))[0] ?? null,
      appts,
      certExpired: me.role === "med_caregiver" && (await medCertExpired(tx, me.id, today)),
    };
  });
  if (!data) redirect("/dashboard");
  const { homes, home, pass, handoff, appts, certExpired } = data;
  const give = canGiveMeds(me);
  const back = `/meds?home=${home.id}`;
  const due = pass.reduce((n, p) => n + p.slots.filter((s) => s.state === "due" || s.state === "late").length, 0);
  return (
    <>
      <ShiftGate me={me} />
      <div className="row">
        <h1>{give ? "Medication & Diagnosis" : "Medication pass"}</h1>
        <span className="muted">{home.name} · {localClock(now, home.timeZone)} · {due} dose{due === 1 ? "" : "s"} due</span>
      </div>
      {homes.length > 1 && (
        <nav className="chips" aria-label="Homes">
          {homes.map((h) => <Link key={h.id} className="chip" href={`/meds?home=${h.id}`} aria-current={h.id === home.id ? "page" : undefined}>{h.name}</Link>)}
        </nav>
      )}
      {!give && <p className="notice">You can see the medication pass, but only med-certified caregivers can give medications.</p>}
      {certExpired && <p className="banner error" role="alert">Your medication certification on file has expired. Tell the owner or admin before giving medications.</p>}
      {handoff && (
        <p className="notice" style={{ margin: 0 }}>
          <b>Handoff ({SHIFT_LABEL[handoff.n.shift].toLowerCase()} shift, {handoff.by}):</b> {handoff.n.body} <Link href="/shift">All handoff notes</Link>
        </p>
      )}
      {appts.length > 0 && (
        <p className="notice" style={{ margin: 0 }}>
          <b>Appointments today:</b>{" "}
          {appts.map((x, i) => (
            <span key={x.a.id}>{i > 0 && "; "}<Link href={`/residents/${x.a.residentId}?tab=appointments`}>{x.resident}</Link>, {localClock(x.a.scheduledAt, home.timeZone)} with {x.a.provider}</span>
          ))}
        </p>
      )}
      {(() => {
        const overdue = pass.flatMap((p) => p.openFollowups.filter((f) => f.dueAt < now).map((f) => ({ ...f, who: `${p.resident.firstName} ${p.resident.lastName}`, rid: p.resident.id })));
        if (!overdue.length) return null;
        return (
          <div className="banner error" role="alert">
            <b>{overdue.length} as-needed follow-up{overdue.length === 1 ? "" : "s"} overdue:</b>{" "}
            {overdue.map((f, i) => (
              <span key={f.id}>
                {i > 0 && "; "}
                <a href={`#r-${f.rid}`}>{f.who}</a> ({f.medication}, due {localClock(f.dueAt, home.timeZone)})
              </span>
            ))}
            . Check how each dose worked and record it below.
          </div>
        );
      })()}
      {pass.length === 0 && <p className="muted">No residents at this home yet.</p>}
      {pass.map(({ resident: r, slots, prnOrders, openFollowups }) => {
        const shown = slots.filter((s) => s.state !== "upcoming");
        const later = slots.length - shown.length;
        return (
          <section key={r.id} className="card" aria-labelledby={`r-${r.id}`}>
            <div className="row">
              <ResidentPhoto src={residentPhotoUrl(r)} name={`${r.firstName} ${r.lastName}`} size={56} />
              <h2 id={`r-${r.id}`} style={{ fontSize: 17, textTransform: "none", letterSpacing: 0, color: "var(--ink)" }}>
                <Link href={`/residents/${r.id}`}>{r.firstName} {r.lastName}</Link> <span className="muted small">Room {r.room}</span>
              </h2>
              <span className="spacer" />
              <Link className="btn small" href={`/residents/${r.id}?tab=diagnoses`}>Diagnoses</Link>
              <Link className="btn small" href={`/residents/${r.id}?tab=record`}>Medication record</Link>
              {r.allergies.length > 0 && <span className="allergy small">Allergies: {r.allergies.join(", ")}</span>}
            </div>
            {openFollowups.map((f) => (
              <div key={f.id} className="dose">
                <span><b>Check how it worked:</b> {f.medication}<br />{f.dueAt < now ? <span className="pill crit">Overdue since {localClock(f.dueAt, home.timeZone)}</span> : <span className="small muted">Due at {localClock(f.dueAt, home.timeZone)}</span>}</span>
                <FollowupForm action={followupAction} followupId={f.id} residentId={r.id} />
              </div>
            ))}
            {shown.map((s) => <SlotRow key={`${s.order.id}${s.time}`} slot={s} tz={home.timeZone} canGive={give} back={back} />)}
            {later > 0 && <p className="small muted">{later} later today</p>}
            {prnOrders.map((o) => (
              <div key={o.id} className="dose">
                <span><b>{o.name}</b> {o.strength} <span className="pill info">As needed</span><br /><span className="small muted">{o.prnReasons.join(", ")}</span></span>
                {give && <Link className="btn big" style={{ whiteSpace: "nowrap" }} href={`/meds/as-needed/${o.id}?back=${encodeURIComponent(back)}`}><Icon name="pill" size={20} />Give as needed</Link>}
              </div>
            ))}
            {!shown.length && !prnOrders.length && !openFollowups.length && <p className="small muted">Nothing due right now.</p>}
          </section>
        );
      })}
    </>
  );
}
