import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["owner", "admin", "manager", "nurse", "med_caregiver", "caregiver"]);
export const userStatusEnum = pgEnum("user_status", ["invited", "active", "deactivated"]);

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A customer organization (tenant). Every other row carries its org_id. */
export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const facilities = pgTable(
  "facilities",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    licenseType: text("license_type").notNull().default("IDD"),
    beds: integer("beds").notNull().default(0),
    timeZone: text("time_zone").notNull().default("America/New_York"),
    createdAt: createdAt(),
  },
  (t) => [index("facilities_org_idx").on(t.orgId)],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: roleEnum("role").notNull(),
    status: userStatusEnum("status").notNull().default("invited"),
    passwordHash: text("password_hash"),
    /** TOTP secret, encrypted with the data encryption key. */
    mfaSecretEnc: text("mfa_secret_enc"),
    mfaEnabled: boolean("mfa_enabled").notNull().default(false),
    failedLogins: integer("failed_logins").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivationReason: text("deactivation_reason"),
    createdAt: createdAt(),
  },
  (t) => [
    // One account per email per organization (spec: Adding staff rules).
    uniqueIndex("users_org_email_uq").on(t.orgId, sql`lower(${t.email})`),
    index("users_email_idx").on(sql`lower(${t.email})`),
  ],
);

export const userFacilities = pgTable(
  "user_facilities",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
  },
  (t) => [primaryKey({ columns: [t.userId, t.facilityId] })],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    /** SHA-256 of the cookie token; the token itself is never stored. */
    tokenHash: text("token_hash").notNull(),
    /** False until the second step (TOTP) has been passed. */
    mfaPassed: boolean("mfa_passed").notNull().default(false),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    userAgent: text("user_agent"),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** Single-use links: invitations, reactivations and password resets. */
export const tokenPurposeEnum = pgEnum("token_purpose", ["invite", "reset", "reactivate"]);
export const accountTokens = pgTable(
  "account_tokens",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    purpose: tokenPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("account_tokens_hash_uq").on(t.tokenHash), index("account_tokens_user_idx").on(t.userId)],
);

/** Append-only. Updates and deletes are blocked by a trigger (see custom migration). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    actorId: uuid("actor_id").references(() => users.id),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_org_at_idx").on(t.orgId, t.at)],
);

/** Development stand-in for an email provider: messages land here and in the server log. */
export const outbox = pgTable("outbox", {
  id: id(),
  orgId: uuid("org_id").references(() => organizations.id),
  to: text("to").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

export type Role = (typeof roleEnum.enumValues)[number];
export type User = typeof users.$inferSelect;
export type Facility = typeof facilities.$inferSelect;
