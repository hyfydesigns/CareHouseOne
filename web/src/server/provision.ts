import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { DB } from "@/db/client";
import { accountTokens, facilities, organizations, subscriptions, userFacilities, users } from "@/db/schema";
import { randomToken, sha256 } from "@/lib/crypto";
import { validZone } from "@/lib/time-zones";
import { audit, sendMail } from "./audit";
import { INVITE_DAYS } from "./auth";

export const provisionSchema = z.object({
  orgName: z.string().trim().min(2).max(120),
  homes: z
    .array(
      z.object({
        name: z.string().trim().min(2).max(120),
        timeZone: z.string().refine(validZone, "Unknown time zone, use a name like America/Chicago."),
        beds: z.number().int().min(0).max(500).default(0),
        licenseType: z.string().trim().min(1).max(40).default("IDD"),
      }),
    )
    .min(1),
  owner: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email() }),
});

export type ProvisionInput = z.input<typeof provisionSchema>;

/**
 * Creates a customer organization, its homes and an invitation for its owner, who then sets a
 * password and invites everyone else from the app. Used by the
 * developer (scripts/create-org.ts) and by self-service sign-up after a PayPal subscription
 * (billing.ts), which passes the setup link's hash to claim that subscription.
 */
export async function provisionOrganization(
  db: DB,
  raw: ProvisionInput,
  appUrl: string,
  opts: { setupTokenHash?: string } = {},
): Promise<{ orgId: string; inviteLink: string }> {
  const input = provisionSchema.parse(raw);
  return db.transaction(async (tx) => {
    const [dup] = await tx.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${input.owner.email}`);
    if (dup) throw new Error(`An account already exists for ${input.owner.email}.`);
    const [org] = await tx.insert(organizations).values({ name: input.orgName }).returning();
    if (opts.setupTokenHash) {
      // Self-service sign-up: claim the paid subscription. Only one organization per subscription,
      // and the link works once even if two tabs submit at the same moment.
      const claimed = await tx
        .update(subscriptions)
        .set({ orgId: org.id, setupUsedAt: new Date() })
        .where(and(eq(subscriptions.setupTokenHash, opts.setupTokenHash), isNull(subscriptions.setupUsedAt), isNull(subscriptions.orgId), gt(subscriptions.setupExpiresAt, new Date())))
        .returning({ id: subscriptions.id });
      if (!claimed.length) throw new Error("This setup link has expired or was already used.");
    }
    const homes = await tx
      .insert(facilities)
      .values(input.homes.map((h) => ({ orgId: org.id, name: h.name, timeZone: h.timeZone, beds: h.beds, licenseType: h.licenseType })))
      .returning();
    const [owner] = await tx.insert(users).values({ orgId: org.id, email: input.owner.email, name: input.owner.name, role: "owner", status: "invited" }).returning();
    await tx.insert(userFacilities).values(homes.map((h) => ({ orgId: org.id, userId: owner.id, facilityId: h.id })));
    const token = randomToken();
    await tx.insert(accountTokens).values({ orgId: org.id, userId: owner.id, purpose: "invite", tokenHash: sha256(token), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) });
    const inviteLink = `${appUrl}/invite/${token}`;
    await sendMail(tx, {
      orgId: org.id,
      to: owner.email,
      subject: "Your CareHouse One account is ready",
      body: `Hi ${owner.name},\n\nCareHouse One is set up for ${org.name}. Use this link to set your password. It works once and expires in ${INVITE_DAYS} days.\n\n${inviteLink}\n\nThen add your staff from the Staff page and register each home's tablet in Settings.`,
    });
    await audit(tx, { orgId: org.id, actorId: null, action: "organization_created", entity: "organization", entityId: org.id, details: { homes: homes.map((h) => h.name) } });
    return { orgId: org.id, inviteLink };
  });
}
