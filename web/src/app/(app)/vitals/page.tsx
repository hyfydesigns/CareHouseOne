import { getDb, withTenant } from "@/db/client";
import { requireUser } from "@/lib/session";
import { listResidents } from "@/server/residents";
import { VitalsPanel } from "../care/panels";
import { ResidentPicker } from "../care/resident-picker";

export default async function VitalsPage({ searchParams }: { searchParams: Promise<{ r?: string; m?: string }> }) {
  const me = await requireUser();
  const sp = await searchParams;
  const rs = await withTenant(await getDb(), me.orgId, (tx) => listResidents(tx, { id: me.id, role: me.role, facilityIds: me.facilityIds }));
  const r = rs.find((x) => x.id === sp.r) ?? rs[0];
  return (
    <>
      <h1>Vital signs</h1>
      <ResidentPicker residents={rs} current={r?.id} base="/vitals" />
      {r ? (
        <>
          <p className="muted" style={{ margin: 0 }}>{r.firstName} {r.lastName} · Room {r.room}</p>
          <VitalsPanel resident={r} me={me} mParam={sp.m} base={`/vitals?r=${r.id}`} />
        </>
      ) : (
        <p className="muted">No residents yet.</p>
      )}
    </>
  );
}
