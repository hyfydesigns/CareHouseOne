import Link from "next/link";
import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { localDate, localTime } from "@/lib/time";
import { shiftHomes, shiftStatus } from "@/server/care";
import { INCIDENT_TYPES, residentsForIncident, USUALLY_REPORTABLE } from "@/server/incidents";
import { visibleFacilities } from "@/server/residents";
import { fileIncidentAction } from "../actions";
import { IncidentForm } from "../forms";

export default async function NewIncidentPage({ searchParams }: { searchParams: Promise<{ resident?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const now = new Date();
  const data = await withTenant(await getDb(), me.orgId, async (tx) => {
    const homes = await visibleFacilities(tx, me);
    const people = await residentsForIncident(tx, homes.map((h) => h.id));
    const shiftHome = (await shiftStatus(tx, me))?.facilityId ?? shiftHomes(me, me.device?.facilityIds)[0];
    return { homes, people, shiftHome };
  });
  if (!data.homes.length) return <p className="muted">You&apos;re not assigned to a home yet. Ask your manager.</p>;
  const picked = data.people.find((p) => p.id === sp.resident);
  const defaultHome = picked?.facilityId ?? data.homes.find((h) => h.id === data.shiftHome)?.id ?? data.homes[0].id;
  return (
    <>
      <div>
        <Link href="/incidents" className="small">‹ Incident reports</Link>
        <h1>Report an incident</h1>
        <p className="muted">Fill this in as soon as everyone is safe, while it&apos;s fresh. Write what happened, not what you think caused it.</p>
      </div>
      <IncidentForm
        action={fileIncidentAction}
        homes={data.homes.map((h) => ({ id: h.id, name: h.name, today: localDate(now, h.timeZone), now: localTime(now, h.timeZone) }))}
        residents={data.people.map((p) => ({ id: p.id, facilityId: p.facilityId, name: `${p.firstName} ${p.lastName}` }))}
        types={Object.entries(INCIDENT_TYPES)}
        reportable={USUALLY_REPORTABLE}
        defaultHome={defaultHome}
        defaultResident={picked?.id}
      />
    </>
  );
}
