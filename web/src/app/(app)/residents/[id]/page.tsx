import Link from "next/link";
import { ResidentPhoto, residentPhotoUrl } from "@/components/resident-photo";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { getDb, withTenant } from "@/db/client";
import { facilities, organizations } from "@/db/schema";
import { canGiveMeds, canManageCare } from "@/lib/permissions";
import { requireUser } from "@/lib/session";
import { clock, localClock, localDate } from "@/lib/time";
import { listOrders, monthRecord, openFollowups, residentSlots } from "@/server/meds";
import { getResident, visibleFacilities } from "@/server/residents";
import { addOrderAction, dischargeAction, followupAction, readmitAction, stopOrderAction, updateResidentAction } from "../../care-actions";
import { AddOrderForm, DischargeForm, EditResidentForm, FollowupForm, ReadmitForm, StopOrderButton } from "../../care-forms";
import { SlotRow } from "../../meds/slot-row";
import { PhotoUpload } from "./photo-upload";
import { DiagnosesPanel, NotesPanel, VitalsPanel } from "../../care/panels";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const TABS = [["today", "Today"], ["orders", "Medication orders"], ["record", "Medication record"], ["diagnoses", "Diagnoses"], ["vitals", "Vital signs"], ["notes", "Progress notes"], ["card", "Wristband card"], ["details", "Details"]] as const;

/** A contact in the resident header: name, relationship and a tap-to-call number (email stays on Details). */
function Contact({ label, name, relationship, phone }: { label: string; name: string | null; relationship: string | null; phone: string | null }) {
  if (!name && !phone) return null;
  return (
    <p className="small" style={{ margin: "4px 0 0" }}>
      <b>{label}:</b> {name}
      {relationship ? ` (${relationship})` : ""}
      {phone && (
        <>
          {" · "}
          <a href={`tel:${phone.replace(/[^0-9+]/g, "")}`}>{phone}</a>
        </>
      )}
    </p>
  );
}

export default async function ResidentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; m?: string; q?: string; cat?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const me = await requireUser();
  // Details (editing, discharge) is for owners and admins.
  const tab = TABS.some((t) => t[0] === sp.tab) && (sp.tab !== "details" || canManageCare(me)) ? sp.tab! : "today";
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const r = await getResident(tx, actor, id);
    if (!r) return null;
    const [home] = await tx.select().from(facilities).where(eq(facilities.id, r.facilityId));
    const [org] = await tx.select({ check: organizations.residentCheck }).from(organizations).where(eq(organizations.id, r.orgId));
    const today = localDate(now, home.timeZone);
    const [cy, cm] = today.split("-").map(Number);
    const m = /^\d{4}-\d{2}$/.test(sp.m ?? "") ? sp.m! : `${cy}-${String(cm).padStart(2, "0")}`;
    const [y, mo] = m.split("-").map(Number);
    return {
      r,
      home,
      wristbands: org.check === "wristband",
      today,
      ym: { y, mo, cy, cm },
      slots: tab === "today" ? await residentSlots(tx, r, now) : [],
      followups: tab === "today" ? await openFollowups(tx, r.id) : [],
      orders: tab === "orders" ? await listOrders(tx, r.id) : [],
      record: tab === "record" ? await monthRecord(tx, r, y, mo, now) : null,
      homes: tab === "details" ? (await visibleFacilities(tx, actor)).map((h) => ({ id: h.id, name: h.name })) : [],
    };
  });
  if (!data) notFound();
  const { r, home } = data;
  const prev = data.ym.mo === 1 ? `${data.ym.y - 1}-12` : `${data.ym.y}-${String(data.ym.mo - 1).padStart(2, "0")}`;
  const next = data.ym.mo === 12 ? `${data.ym.y + 1}-01` : `${data.ym.y}-${String(data.ym.mo + 1).padStart(2, "0")}`;
  const isCurrent = data.ym.y === data.ym.cy && data.ym.mo === data.ym.cm;
  const qr = tab === "card" ? await QRCode.toDataURL(r.wristbandCode, { margin: 1, width: 180 }) : null;

  return (
    <>
      <div className="card">
        <div className="row" style={{ alignItems: "start" }}>
          <ResidentPhoto src={residentPhotoUrl(r)} name={`${r.firstName} ${r.lastName}`} size={88} />
          <div>
            <h1>{r.firstName} {r.lastName}</h1>
            <p className="muted" style={{ margin: 0 }}>
              Room {r.room} · {home.name}{r.dateOfBirth ? ` · Born ${r.dateOfBirth}` : ""} · Diet: {r.diet} · {r.codeStatus}
            </p>
            <Contact label="Guardian" name={r.guardian} relationship={r.guardianRelationship} phone={r.guardianPhone} />
            <Contact label="Emergency contact" name={r.emergencyName} relationship={r.emergencyRelationship} phone={r.emergencyPhone} />
            {r.status === "discharged" && (
              <p className="pill mute" style={{ marginTop: 6 }}>Discharged {r.dischargedOn}{r.dischargeReason ? ` · ${r.dischargeReason}` : ""}</p>
            )}
          </div>
          <span className="spacer" />
          {r.allergies.length ? <span className="allergy">Allergies: {r.allergies.join(", ")}</span> : <span className="pill ok">No known allergies</span>}
        </div>
      </div>
      <nav className="chips" aria-label="Resident sections">
        {TABS.filter(([k]) => (k !== "card" || data.wristbands) && (k !== "details" || canManageCare(me))).map(([k, label]) => (
          <Link key={k} className="chip" href={`/residents/${r.id}?tab=${k}`} aria-current={tab === k ? "page" : undefined}>{label}</Link>
        ))}
      </nav>

      {tab === "today" && (
        <>
          {data.followups.length > 0 && (
            <section className="card" style={{ borderColor: "var(--warn)" }}>
              <h2>Check how it worked</h2>
              {data.followups.map((f) => (
                <div key={f.id} className="dose">
                  <span><b>{f.medication}</b><br />{f.dueAt < now ? <span className="pill crit">Overdue since {localClock(f.dueAt, home.timeZone)}</span> : <span className="small muted">Due at {localClock(f.dueAt, home.timeZone)}</span>}</span>
                  <FollowupForm action={followupAction} followupId={f.id} residentId={r.id} />
                </div>
              ))}
            </section>
          )}
          <section className="card">
            <h2>Today&apos;s medications</h2>
            {data.slots.length ? data.slots.map((s) => <SlotRow key={`${s.order.id}${s.time}`} slot={s} tz={home.timeZone} canGive={canGiveMeds(me)} back={`/residents/${r.id}`} />) : <p className="muted">No scheduled medications today.</p>}
          </section>
        </>
      )}

      {tab === "orders" && (
        <section className="card">
          <div className="row">
            <h2>Medication orders</h2>
            <span className="spacer" />
            {canManageCare(me) && <AddOrderForm action={addOrderAction.bind(null, r.id)} today={data.today} allergies={r.allergies} />}
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Medication</th><th>When</th><th>For</th><th>Dates</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>
                {data.orders.map(({ order: o, createdByName }) => (
                  <tr key={o.id}>
                    <td><b>{o.name}</b> {o.strength}<br /><span className="small muted">{o.route}{o.bpCheck ? " · check BP first" : ""}{o.instructions ? ` · ${o.instructions}` : ""}</span></td>
                    <td>{o.type === "prn" ? <>As needed<br /><span className="small muted">{o.prnReasons.join(", ")} · at least {(o.prnMinIntervalMinutes ?? 0) / 60} h apart, {o.prnMaxPerDay} a day</span></> : o.times.map(clock).join(", ")}</td>
                    <td>{o.purpose}</td>
                    <td className="small">{o.startDate}{o.stopDate ? ` to ${o.stopDate}` : ""}<br /><span className="muted">{o.prescriber ? `${o.prescriber} · ` : ""}entered by {createdByName ?? "unknown"}</span></td>
                    <td>{o.status === "active" ? <span className="pill ok">Active</span> : <span className="pill mute">Stopped</span>}{o.stopReason && <><br /><span className="small muted">{o.stopReason}</span></>}</td>
                    <td style={{ textAlign: "right" }}>{o.status === "active" && canManageCare(me) && <StopOrderButton action={stopOrderAction} orderId={o.id} residentId={r.id} name={o.name} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === "record" && data.record && (
        <section className="card">
          <div className="row">
            <h2>Medication record · {MONTHS[data.ym.mo - 1]} {data.ym.y}</h2>
            <span className="spacer" />
            <Link className="btn small" href={`/residents/${r.id}?tab=record&m=${prev}`}>‹ {MONTHS[(data.ym.mo + 10) % 12].slice(0, 3)}</Link>
            {!isCurrent && <Link className="btn small" href={`/residents/${r.id}?tab=record&m=${next}`}>{MONTHS[data.ym.mo % 12].slice(0, 3)} ›</Link>}
          </div>
          <div className="tablewrap">
            <table className="grid-mar">
              <thead>
                <tr>
                  <th>Medication · time</th>
                  {Array.from({ length: data.record.days }, (_, i) => <th key={i} className={`d${isCurrent && i + 1 === Number(data.today.slice(8)) ? " today" : ""}`}>{i + 1}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.record.rows.map((row) => (
                  <tr key={`${row.order.id}${row.time}`}>
                    <td><b>{row.order.name}</b> {row.order.strength}<br /><span className="muted">{clock(row.time)}</span></td>
                    {row.cells.map((c, i) => (
                      <td key={i} className={`d ${c?.outcome ?? ""}${isCurrent && i + 1 === Number(data.today.slice(8)) ? " today" : ""}`} title={c ? `${c.outcome}${c.late ? " (late)" : ""}` : undefined}>
                        {c ? (c.outcome === "given" ? `${c.by ?? "✓"}${c.late ? "*" : ""}` : c.outcome === "refused" ? "R" : c.outcome === "held" ? "H" : c.outcome === "missed" ? "!" : "•") : ""}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted">Initials = given by · * = late · R = refused · H = held · ! = not recorded · • = due now</p>
          <h2>As-needed doses</h2>
          {data.record.prn.length ? (
            <div className="tablewrap"><table><tbody>{data.record.prn.map((p) => <tr key={p.dose.id}><td>{p.dose.recordedAt.toLocaleString("en-US", { timeZone: home.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit", hour12: true })}</td><td><b>{p.order.name}</b> {p.order.strength}</td><td>{p.dose.reason}</td><td>{p.by}</td></tr>)}</tbody></table></div>
          ) : <p className="muted">None this month.</p>}
        </section>
      )}

      {tab === "details" && (
        <>
          <PhotoUpload residentId={r.id} photo={residentPhotoUrl(r)} name={`${r.firstName} ${r.lastName}`} />
          <EditResidentForm
            action={updateResidentAction.bind(null, r.id)}
            homes={data.homes}
            values={{
              facilityId: r.facilityId,
              firstName: r.firstName,
              lastName: r.lastName,
              room: r.room,
              allergies: r.allergies,
              diet: r.diet,
              codeStatus: r.codeStatus,
              dateOfBirth: r.dateOfBirth,
              admittedOn: r.admittedOn,
              guardian: r.guardian,
              guardianRelationship: r.guardianRelationship,
              guardianPhone: r.guardianPhone,
              guardianEmail: r.guardianEmail,
              emergencyName: r.emergencyName,
              emergencyRelationship: r.emergencyRelationship,
              emergencyPhone: r.emergencyPhone,
            }}
          />
          {r.status === "active" ? (
            <DischargeForm action={dischargeAction.bind(null, r.id)} today={data.today} name={r.firstName} />
          ) : (
            <ReadmitForm action={readmitAction.bind(null, r.id)} today={data.today} />
          )}
        </>
      )}

      {tab === "vitals" && <VitalsPanel resident={r} me={me} mParam={sp.m} base={`/residents/${r.id}?tab=vitals`} />}
      {tab === "notes" && <NotesPanel resident={r} me={me} mParam={sp.m} base={`/residents/${r.id}?tab=notes`} />}
      {tab === "diagnoses" && <DiagnosesPanel resident={r} me={me} q={sp.q} cat={sp.cat} base={`/residents/${r.id}?tab=diagnoses`} />}

      {tab === "card" && qr && (
        <section className="card" style={{ justifyItems: "center", textAlign: "center" }}>
          <h2>Wristband and room card</h2>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={qr} alt={`Code for ${r.firstName} ${r.lastName}`} width={180} height={180} style={{ background: "#fff", padding: 6, borderRadius: 8 }} />
          <span className="wristband">{r.wristbandCode}</span>
          <p className="small muted">Print this for the wristband and room card. Scanning it confirms the right person before every medication.</p>
        </section>
      )}
    </>
  );
}
