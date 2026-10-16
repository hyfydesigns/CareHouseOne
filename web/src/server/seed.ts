import type { DB } from "@/db/client";
import { facilities, organizations, userFacilities, users, type Role } from "@/db/schema";
import { encrypt } from "@/lib/crypto";
import { hashPassword } from "@/lib/password";
import { newTotpSecret } from "@/lib/totp";

/**
 * Local development and test data only. These are not real people. The shared demo password is
 * for local databases; never seed a production database with it.
 */
export const DEMO_PASSWORD = "harbor-demo-2026-local";
/** Shared two-step key for local demo accounts (add it to an authenticator app, or run npm run dev:code). */
export const DEMO_TOTP_SECRET = "JBSWY3DPEHPK3PXPCAREHOUSEDEMOKEY";

export interface Seeded {
  orgId: string;
  facilities: { cedarRidge: string; mapleHouse: string };
  users: Record<"owner" | "manager" | "nurse" | "caregiver", { id: string; email: string; totpSecret: string }>;
}

export async function seedDemo(db: DB, opts: { orgName?: string; emailDomain?: string; fixedTotp?: boolean } = {}): Promise<Seeded> {
  const domain = opts.emailDomain ?? "harborviewliving.test";
  const [org] = await db.insert(organizations).values({ name: opts.orgName ?? "Harborview Community Living" }).returning();
  const [cr] = await db.insert(facilities).values({ orgId: org.id, name: "Cedar Ridge", licenseType: "IDD", beds: 8 }).returning();
  const [mh] = await db.insert(facilities).values({ orgId: org.id, name: "Maple House", licenseType: "IDD", beds: 6 }).returning();
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const people: Array<[keyof Seeded["users"], string, string, Role, string[]]> = [
    ["owner", "Joy Okafor", `joy.okafor@${domain}`, "owner", [cr.id, mh.id]],
    ["manager", "Daniel Ruiz", `daniel.ruiz@${domain}`, "manager", [cr.id]],
    ["nurse", "Priya Shah", `priya.shah@${domain}`, "nurse", [cr.id, mh.id]],
    ["caregiver", "Andre Thomas", `andre.thomas@${domain}`, "med_caregiver", [cr.id]],
  ];
  const out = {} as Seeded["users"];
  for (const [key, name, email, role, facs] of people) {
    const totpSecret = opts.fixedTotp ? DEMO_TOTP_SECRET : newTotpSecret();
    const [u] = await db
      .insert(users)
      .values({ orgId: org.id, name, email, role, status: "active", passwordHash, mfaSecretEnc: encrypt(totpSecret), mfaEnabled: true })
      .returning();
    await db.insert(userFacilities).values(facs.map((facilityId) => ({ orgId: org.id, userId: u.id, facilityId })));
    out[key] = { id: u.id, email, totpSecret };
  }
  return { orgId: org.id, facilities: { cedarRidge: cr.id, mapleHouse: mh.id }, users: out };
}
