import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { homesFor, myShifts, shiftHomes, shiftStatus, todayAtHome } from "@/server/care";
import { shiftAction } from "../care/actions";
import { ShiftButton } from "../care/forms";
import { handoffAction } from "../ops-actions";
import { HandoffForm } from "../ops-forms";
import { recentHandoffs } from "@/server/operations";
import { SHIFT_LABEL } from "@/server/care";
import { monthFrom } from "../care/month";
import Link from "next/link";

const t = (d: Date, tz: string) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });
const day = (d: Date, tz: string) => d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });

export default async function ShiftPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await homesFor(tx, actor);
    const open = await shiftStatus(tx, actor);
    const here = shiftHomes(actor, me.device?.facilityIds);
    const home = homes.find((h) => h.id === (open?.facilityId ?? here[0])) ?? homes[0];
    if (!home) return null;
    const m = monthFrom(sp.m, localDate(now, home.timeZone));
    return { homes, open, home, m, here, today: await todayAtHome(tx, actor, home.id, now), mine: await myShifts(tx, actor, home.id, m.year, m.month), handoffs: await recentHandoffs(tx, actor, home.id, now) };
  });
  if (!data) return <p className="muted">You&apos;re not assigned to a home yet. Ask your manager.</p>;
  const { homes, open, home, m, here, today, mine, handoffs } = data;
  const tz = home.timeZone;
  return (
    <>
      <h1>Sign in / Sign out</h1>
      <section className="card">
        <div className="row" style={{ gap: 14 }}>
          <span>
            <b style={{ fontSize: 20 }}>{me.name}</b>
            <br />
            {open ? <span className="pill ok">Signed in at {t(open.signedInAt, tz)} · {homes.find((h) => h.id === open.facilityId)?.name}</span> : <span className="pill mute">Not signed in</span>}
          </span>
        </div>
        <ShiftButton action={shiftAction} signedIn={!!open} homes={me.device ? homes.filter((h) => here.includes(h.id)).map((h) => ({ id: h.id, name: h.name })) : null} />
      </section>
      <section className="card" aria-labelledby="handoff-h">
        <div className="row">
          <h2 id="handoff-h" style={{ margin: 0 }}>Shift handoff · {home.name}</h2>
          <span className="spacer" />
          <Link className="btn small" href="/safety">Record a fire drill</Link>
        </div>
        {handoffs.length ? (
          <ul className="stack" style={{ margin: 0, paddingLeft: 18 }}>
            {handoffs.map(({ n, by }) => (
              <li key={n.id}>
                <span className="small muted">{SHIFT_LABEL[n.shift]} shift · {by} · {t(n.recordedAt, tz)}</span>
                <div style={{ whiteSpace: "pre-wrap" }}>{n.body}</div>
              </li>
            ))}
          </ul>
        ) : <p className="muted" style={{ margin: 0 }}>No handoff notes from the last 16 hours.</p>}
        <HandoffForm action={handoffAction} facilityId={home.id} home={home.name} />
      </section>
      <div className="row" style={{ alignItems: "start" }}>
        <section className="card" style={{ flex: "1 1 340px" }}>
          <h2>Today at {home.name}</h2>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Who</th><th>In</th><th>Out</th></tr></thead>
              <tbody>
                {today.length ? today.map(({ p, name }) => (
                  <tr key={p.id}><td>{name}</td><td>{t(p.signedInAt, tz)}</td><td>{p.signedOutAt ? t(p.signedOutAt, tz) : <span className="pill ok">On shift</span>}</td></tr>
                )) : <tr><td colSpan={3} className="muted">No one has signed in yet today.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
        <section className="card" style={{ flex: "1 1 340px" }}>
          <div className="row">
            <h2>My shifts · {m.label}</h2>
            <span className="spacer" />
            <Link className="btn small" href={`/shift?m=${m.prev}`}>‹ {m.prevLabel}</Link>
            {m.next && <Link className="btn small" href={`/shift?m=${m.next}`}>{m.nextLabel} ›</Link>}
          </div>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Day</th><th>In</th><th>Out</th><th>Hours</th></tr></thead>
              <tbody>
                {mine.rows.length ? mine.rows.map((p) => (
                  <tr key={p.id}><td>{day(p.signedInAt, tz)}</td><td>{t(p.signedInAt, tz)}</td><td>{p.signedOutAt ? t(p.signedOutAt, tz) : "—"}</td><td>{p.hours == null ? "—" : p.hours.toFixed(1)}</td></tr>
                )) : <tr><td colSpan={4} className="muted">No shifts this month.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }}>{mine.total.toFixed(1)} hours on completed shifts this month.</p>
        </section>
      </div>
    </>
  );
}
