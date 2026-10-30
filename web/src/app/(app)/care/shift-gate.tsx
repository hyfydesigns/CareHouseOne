import { getDb, withTenant } from "@/db/client";
import { CAREGIVER_ROLES } from "@/lib/permissions";
import type { SessionUser } from "@/server/auth";
import { homesFor, shiftHomes, shiftStatus } from "@/server/care";
import { shiftAction } from "./actions";
import { ShiftButton } from "./forms";

/**
 * Caregivers record care only while on shift. When they aren't, the screens they record on open
 * with this card: one tap starts the shift and they carry on. Owners and admins never see it.
 */
export async function ShiftGate({ me }: { me: SessionUser }) {
  if (!CAREGIVER_ROLES.includes(me.role)) return null;
  const data = await withTenant(await getDb(), me.orgId, async (tx) => ({ open: await shiftStatus(tx, me), homes: await homesFor(tx, me) }));
  if (data.open) return null;
  const here = shiftHomes(me, me.device?.facilityIds);
  return (
    <section className="card shift-gate" aria-labelledby="gate-h">
      <h2 id="gate-h" style={{ margin: 0 }}>Start your shift first</h2>
      <p className="small muted" style={{ margin: 0 }}>You need to be on shift to give medications or record vital signs, notes and daily care. Your hours start counting now.</p>
      <ShiftButton action={shiftAction} signedIn={false} homes={me.device ? data.homes.filter((h) => here.includes(h.id)).map((h) => ({ id: h.id, name: h.name })) : null} />
    </section>
  );
}
