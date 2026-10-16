/**
 * Creates a customer organization in the production database and emails its owner an invitation.
 *
 *   npm run org:create -- org.json
 *
 * org.json (keep it out of the repository):
 *   {
 *     "orgName": "Harborview Community Living",
 *     "homes": [{ "name": "Cedar Ridge", "timeZone": "America/Chicago", "beds": 8 }],
 *     "owner": { "name": "Joy Okafor", "email": "joy@example.com" }
 *   }
 *
 * Needs DATABASE_URL (through the Cloud SQL Auth Proxy, see deploy/README.md), APP_URL, and
 * SMTP_URL / MAIL_FROM to send the email. Add --print-link to show the invitation link instead
 * of relying on email; it's a secret, so only share it with the owner directly.
 */
import { readFileSync } from "node:fs";
import { getDb } from "../src/db/client";
import { deliverOutbox } from "../src/server/mailer";
import { provisionOrganization } from "../src/server/provision";

async function main() {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  const printLink = process.argv.includes("--print-link");
  if (!file) throw new Error("Usage: npm run org:create -- org.json [--print-link]");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL isn't set. This script is for the production database; locally, use npm run db:seed.");
  const appUrl = process.env.APP_URL?.replace(/\/$/, "");
  if (!appUrl?.startsWith("https://")) throw new Error("Set APP_URL to the app's https address so the invitation link works.");
  const db = await getDb();
  const { orgId, inviteLink } = await provisionOrganization(db, JSON.parse(readFileSync(file, "utf8")), appUrl);
  console.log(`Created organization ${orgId}.`);
  const mail = await deliverOutbox(db);
  if (mail.sent) console.log("Invitation emailed to the owner.");
  else console.log("The invitation email wasn't sent (SMTP_URL missing or failing). It stays queued and will retry.");
  if (printLink) console.log(`Invitation link (expires in 7 days, works once): ${inviteLink}`);
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
