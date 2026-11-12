import { getDb } from "@/db/client";
import { getLead } from "@/server/admin";
import { createClientAction } from "../../../actions";
import { ActionForm } from "../../../forms";

const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];

export default async function NewClientPage({ searchParams }: { searchParams: Promise<{ lead?: string }> }) {
  const { lead: leadId } = await searchParams;
  const lead = leadId ? await getLead(await getDb(), leadId) : null;
  return (
    <>
      <div>
        <h1>Add a client</h1>
        <p className="muted">Creates the organization and its homes, and emails the owner an invitation to set their password. They add their own staff and tablets.</p>
      </div>
      <section className="card">
        <ActionForm action={createClientAction} submit="Create client and invite the owner">
          {lead && <input type="hidden" name="leadId" value={lead.id} />}
          {lead && <p className="notice" style={{ margin: 0 }}>From the demo request by {lead.name} ({lead.organization}). The lead will be marked won.</p>}
          <div className="field">
            <label htmlFor="orgName">Organization name</label>
            <input id="orgName" name="orgName" required minLength={2} maxLength={120} defaultValue={lead?.organization ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="homes">Homes, one per line</label>
            <textarea id="homes" name="homes" rows={4} required placeholder={"Cedar Ridge\nMaple House"} />
          </div>
          <div className="field">
            <label htmlFor="timeZone">Time zone of the homes</label>
            <select id="timeZone" name="timeZone" defaultValue="America/Chicago">
              {ZONES.map((z) => (
                <option key={z} value={z}>{z.split("/")[1].replace("_", " ")}</option>
              ))}
            </select>
            <span className="small muted">The owner can change a home&apos;s time zone later in Settings.</span>
          </div>
          <div className="field">
            <label htmlFor="ownerName">Owner&apos;s name</label>
            <input id="ownerName" name="ownerName" required minLength={2} maxLength={120} defaultValue={lead?.name ?? ""} />
          </div>
          <div className="field">
            <label htmlFor="ownerEmail">Owner&apos;s email</label>
            <input id="ownerEmail" name="ownerEmail" type="email" required defaultValue={lead?.email ?? ""} />
          </div>
        </ActionForm>
      </section>
    </>
  );
}
