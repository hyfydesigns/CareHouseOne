import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { localDate } from "@/lib/time";
import { homesFor, myShifts, shiftStatus, todayAtHome } from "@/server/care";
import { shiftAction } from "../care/actions";
import { ShiftButton } from "../care/forms";
import { monthFrom } from "../care/month";
import Link from "next/link";

const t = (d: Date, tz: string) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false });
const day = (d: Date, tz: string) => d.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });

export default async function ShiftPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await homesFor(tx, actor);
    const open = await shiftStatus(tx, actor);
    const home = homes.find((h) => h.id === open?.facilityId) ?? homes[0];
    if (!home) return null;
    const m = monthFrom(sp.m, localDate(now, home.timeZone));
    return { homes, open, home, m, today: await todayAtHome(tx, actor, home.id, now), mine: await myShifts(tx, actor, home.id, m.year, m.month) };
  });
  if (!data) return <p className="muted">You&apos;re not assigned to a home yet. Ask your manager.</p>;
  const { homes, open, home, m, today, mine } = data;
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
        <ShiftButton action={shiftAction} signedIn={!!open} homes={homes.map((h) => ({ id: h.id, name: h.name }))} />
        <p className="small muted" style={{ margin: 0 }}>On the shared tablet, each person unlocks it with their own sign-in, then signs in or out of their shift here.</p>
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
