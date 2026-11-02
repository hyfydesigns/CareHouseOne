import Link from "next/link";
import { Icon } from "@/components/icon";
import { getDb, withTenant } from "@/db/client";
import { CAREGIVER_ROLES } from "@/lib/permissions";
import { localClock } from "@/lib/time";
import { appointmentsSoon } from "@/server/appointments";
import type { SessionUser } from "@/server/auth";
import { shiftHomes, shiftStatus } from "@/server/care";

function inHowLong(at: Date, now: Date): string {
  const mins = Math.round((at.getTime() - now.getTime()) / 60_000);
  if (mins <= 0) return mins > -5 ? "now" : `started ${-mins} min ago`;
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `in ${h} hr${m ? ` ${m} min` : ""}`;
}

/**
 * On the caregiver screens: appointments at the shift's home in the next few hours, so whoever
 * is on shift gets the resident ready in time. Owners and admins see appointments on the dashboard.
 */
export async function ComingUp({ me }: { me: SessionUser }) {
  if (!CAREGIVER_ROLES.includes(me.role)) return null;
  const now = new Date();
  const soon = await withTenant(await getDb(), me.orgId, async (tx) => {
    const open = await shiftStatus(tx, me);
    const homes = open ? [open.facilityId] : shiftHomes(me, me.device?.facilityIds);
    return appointmentsSoon(tx, me, homes, now);
  });
  if (!soon.length) return null;
  return (
    <section className="coming-up" aria-labelledby="soon-h">
      <h2 id="soon-h"><Icon name="calendar" size={20} />Coming up</h2>
      {soon.map((x) => (
        <div key={x.a.id} className="coming-up-item">
          <div>
            <Link href={`/residents/${x.a.residentId}?tab=appointments`}><b>{x.resident}</b></Link> · {x.a.provider} at <b>{localClock(x.a.scheduledAt, x.tz)}</b>
            <span className="pill info" style={{ marginLeft: 6 }}>{inHowLong(x.a.scheduledAt, now)}</span>
          </div>
          <div className="small muted">
            {x.a.purpose}{x.a.location ? ` · ${x.a.location}` : ""}
          </div>
          <div className="small">Get ready: dressed and ready to leave, medication list, ID and insurance card.{x.a.notes ? ` ${x.a.notes}` : ""}</div>
        </div>
      ))}
    </section>
  );
}
