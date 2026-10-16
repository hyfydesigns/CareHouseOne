import { redirect } from "next/navigation";
import { getDb, withTenant } from "@/db/client";
import { canViewAudit } from "@/lib/permissions";
import { currentDevice, requireUser } from "@/lib/session";
import { asc } from "drizzle-orm";
import { facilities } from "@/db/schema";
import { listDevices } from "@/server/devices";
import { getOrg } from "@/server/org";
import { forgetThisDeviceAction, registerDeviceAction, residentCheckAction, revokeDeviceAction } from "./actions";
import { ForgetDeviceButton, RegisterDeviceForm, ResidentCheckForm, RevokeDeviceButton } from "./settings-form";

export default async function SettingsPage() {
  const me = await requireUser();
  if (!canViewAudit(me)) redirect("/dashboard");
  const actor = { id: me.id, role: me.role, facilityIds: me.facilityIds };
  const data = await withTenant(await getDb(), me.orgId, async (tx) => ({ org: await getOrg(tx, me.orgId), devices: await listDevices(tx, actor), homes: await tx.select().from(facilities).orderBy(asc(facilities.name)) }));
  if (!data.org) redirect("/dashboard");
  const here = await currentDevice();
  const tz = data.homes[0]?.timeZone ?? "UTC";
  const when = (d: Date | null) => (d ? d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "—");
  const active = data.devices.filter((r) => !r.d.revokedAt);
  return (
    <>
      <div>
        <h1>Settings</h1>
        <p className="muted">{data.org.name}</p>
      </div>
      <section className="card">
        <h2>Home tablets</h2>
        <p className="small muted" style={{ margin: 0 }}>
          Caregivers can only sign in to a shift on a registered tablet, and the shift is recorded at that tablet&apos;s home. On a tablet, each person sets a PIN after
          signing in; the tablet locks after 2 minutes without a touch and hides everything until the PIN is entered.
        </p>
        {here ? (
          <div className="row">
            <span className="pill ok">This browser is the registered tablet “{here.name}”</span>
            <ForgetDeviceButton action={forgetThisDeviceAction} />
          </div>
        ) : (
          <>
            <p className="small" style={{ margin: 0 }}>To register a tablet, open this page on the tablet itself, signed in as an owner or administrator.</p>
            <RegisterDeviceForm action={registerDeviceAction} homes={data.homes.map((h) => ({ id: h.id, name: h.name }))} />
          </>
        )}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Tablet</th><th>Home</th><th>Registered</th><th>Last used</th><th></th></tr></thead>
            <tbody>
              {active.length ? active.map(({ d, home, by }) => (
                <tr key={d.id}>
                  <td>{d.name}{here?.id === d.id && <span className="pill info" style={{ marginLeft: 6 }}>This one</span>}</td>
                  <td>{home}</td>
                  <td>{when(d.registeredAt)}{by && <span className="small muted"> · {by}</span>}</td>
                  <td>{when(d.lastSeenAt)}</td>
                  <td><RevokeDeviceButton action={revokeDeviceAction} deviceId={d.id} name={d.name} /></td>
                </tr>
              )) : <tr><td colSpan={5} className="muted">No tablets registered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      <ResidentCheckForm action={residentCheckAction} current={data.org.residentCheck} />
    </>
  );
}
