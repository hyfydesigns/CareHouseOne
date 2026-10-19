/**
 * Lists organizations, and permanently removes TEST ones (never had a resident or care record).
 *
 *   npm run org:remove                          list organizations and unclaimed PayPal sign-ups
 *   npm run org:remove -- --delete ORG_ID       remove one test organization (asks for its name)
 *   npm run org:remove -- --unclaimed I-XXXX    remove a PayPal sign-up that never set up an org
 *
 * Needs DATABASE_URL (Cloud SQL Auth Proxy, see deploy/README.md step 5). Cancel any sandbox
 * subscriptions in PayPal separately. Keep the printed summary with your records.
 */
import { createInterface } from "node:readline/promises";
import { getDb } from "../src/db/client";
import { listOrganizations, listUnclaimedSubscriptions, removeTestOrganization, removeUnclaimedSubscription } from "../src/server/org-removal";

const day = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  const db = await getDb();
  const args = process.argv.slice(2);
  const del = args.indexOf("--delete");
  const unclaimed = args.indexOf("--unclaimed");

  if (del >= 0) {
    const id = args[del + 1];
    const org = (await listOrganizations(db)).find((o) => o.id === id);
    if (!org) throw new Error("No organization with that ID. Run npm run org:remove to list them.");
    console.log(`About to permanently remove "${org.name}" (created ${day(org.createdAt)}, owners: ${org.owners.join(", ") || "none"}, ${org.staff} accounts, ${org.homes} homes, ${org.residents} residents).`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const typed = (await rl.question("Type the organization's name to confirm: ")).trim();
    rl.close();
    const r = await removeTestOrganization(db, id, typed);
    if (!r.ok) throw new Error(r.error);
    console.log(`Removed on ${new Date().toISOString()}: organization ${id} "${org.name}".`);
    for (const [what, n] of Object.entries(r.removed)) if (n) console.log(`  ${what}: ${n}`);
    if (org.paypalSubscription) console.log(`Cancel PayPal subscription ${org.paypalSubscription} in PayPal if it's still active.`);
    process.exit(0);
  }

  if (unclaimed >= 0) {
    const id = args[unclaimed + 1];
    if (!(await removeUnclaimedSubscription(db, id))) throw new Error("No unclaimed sign-up with that PayPal ID (it may already be set up as an organization).");
    console.log(`Removed unclaimed sign-up ${id}. Cancel it in PayPal if it's still active.`);
    process.exit(0);
  }

  const orgs = await listOrganizations(db);
  console.log("Organizations (oldest first):");
  for (const o of orgs) {
    console.log(`  ${o.id}  "${o.name}"  created ${day(o.createdAt)}  owners: ${o.owners.join(", ") || "none"}  ${o.homes} homes, ${o.staff} accounts, ${o.residents} residents${o.paypalSubscription ? `  PayPal ${o.paypalSubscription}` : ""}`);
  }
  const loose = await listUnclaimedSubscriptions(db);
  if (loose.length) {
    console.log("PayPal sign-ups that never set up an organization:");
    for (const s of loose) console.log(`  ${s.id}  ${s.payer ?? "no email"}  ${s.status}  ${day(s.createdAt)}`);
  }
  console.log("Only organizations with 0 residents can be removed.");
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
