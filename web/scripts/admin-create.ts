/**
 * Creates an admin for the admin site (admin.carehouseone.com), or gives an existing one a fresh
 * setup link (forgotten password, lost phone: the authenticator is reset too, and they're signed out).
 *
 *   npm run admin:create -- you@example.com "Your Name"
 *
 * Prints a single-use setup link (valid 2 days) where you set a password and scan a QR code with an
 * authenticator app. The link is a secret: open it yourself, don't send it around.
 *
 * Production: needs DATABASE_URL (through the Cloud SQL Auth Proxy, see deploy/README.md) and
 * ADMIN_URL. Locally (no DATABASE_URL) it uses the local database; stop `npm run dev` first, since
 * only one process can open it.
 */
import { getDb } from "../src/db/client";
import { adminBaseUrl } from "../src/lib/hosts";
import { createAdmin } from "../src/server/admin-auth";

async function main() {
  const [email, ...nameParts] = process.argv.slice(2);
  const name = nameParts.join(" ").trim();
  if (!email || !email.includes("@") || name.length < 2) throw new Error('Usage: npm run admin:create -- you@example.com "Your Name"');
  if (process.env.DATABASE_URL && !process.env.ADMIN_URL?.startsWith("https://")) throw new Error("Set ADMIN_URL to the admin site's https address (https://admin.carehouseone.com).");
  const db = await getDb();
  const token = await createAdmin(db, email, name);
  console.log(`Setup link for ${email} (works once, expires in 2 days):\n${adminBaseUrl()}/admin/setup/${token}`);
  process.exit(0);
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
