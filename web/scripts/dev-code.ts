/**
 * Prints the current two-step code for the local demo accounts, which share the fixed demo key
 * in src/server/seed.ts. It doesn't open the database, so it's safe while the dev server runs.
 */
import { currentTotp } from "../src/lib/totp";
import { DEMO_TOTP_SECRET } from "../src/server/seed";

currentTotp(DEMO_TOTP_SECRET).then((code) => console.log(code));
