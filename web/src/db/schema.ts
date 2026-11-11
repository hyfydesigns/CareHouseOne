import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
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

/**
 * How caregivers confirm they have the right person before a medication:
 * two identifiers (name and date of birth, checked by the caregiver) or a wristband scan.
 */
export const residentCheckEnum = pgEnum("resident_check", ["two_identifiers", "wristband"]);

/** A customer organization (tenant). Every other row carries its org_id. */
const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.from(v),
});

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  residentCheck: residentCheckEnum("resident_check").notNull().default("two_identifiers"),
  /** When owners and admins get the appointments email: "evening" (for tomorrow), "morning" (for today) or "off". */
  appointmentReminders: text("appointment_reminders").notNull().default("evening"),
  /** The day the last appointments email was about, so each day is only sent once. */
  appointmentDigestOn: text("appointment_digest_on"),
  /** The organization's logo as a PNG (scaled down when uploaded), shown on forms. */
  logo: bytea("logo"),
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
    /** The home's address and contact details, shown in the header of its forms. */
    street: text("street"),
    city: text("city"),
    state: text("state"),
    zip: text("zip"),
    phone: text("phone"),
    fax: text("fax"),
    email: text("email"),
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
    /** Set when the session was opened on a registered shared tablet. */
    deviceId: uuid("device_id"),
    /** Shared tablets lock when idle; a locked session shows nothing until the PIN is entered. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

/** A shared tablet, used at one or more homes (device_facilities). Shift sign-in only works on a registered device. */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    name: text("name").notNull(),
    /** SHA-256 of the long-lived device cookie. */
    tokenHash: text("token_hash").notNull(),
    registeredBy: uuid("registered_by").notNull().references(() => users.id),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: uuid("revoked_by").references(() => users.id),
  },
  (t) => [uniqueIndex("devices_token_uq").on(t.tokenHash)],
);

/** The homes a tablet is used at (one or more). Caregivers assigned to any of them can sign in on it. */
export const deviceFacilities = pgTable(
  "device_facilities",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.facilityId] })],
);

/** A person's quick-unlock PIN on one tablet, valid until the end of their shift. */
export const devicePins = pgTable(
  "device_pins",
  {
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    deviceId: uuid("device_id").notNull().references(() => devices.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    pinHash: text("pin_hash").notNull(),
    failed: integer("failed").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.deviceId, t.userId] })],
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
  /** Set once the email provider accepted the message. Unsent rows are retried. */
  sentAt: timestamp("sent_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
});

/**
 * Fixed-window counters for sign-in, reset and PIN attempts by IP address. Kept in the database
 * so the limit holds across every Cloud Run instance. Keys never contain passwords or codes.
 */
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- residents and medications

export const residentStatusEnum = pgEnum("resident_status", ["active", "discharged"]);

export const residents = pgTable(
  "residents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    room: text("room").notNull().default(""),
    dateOfBirth: text("date_of_birth"),
    /** Printed on the wristband and the room card; scanned to confirm the right person. */
    wristbandCode: text("wristband_code").notNull(),
    allergies: text("allergies").array().notNull().default(sql`'{}'::text[]`),
    diet: text("diet").notNull().default("Regular"),
    codeStatus: text("code_status").notNull().default("Full code"),
    /** Guardian's name. Name, relationship and phone show to caregivers; email only on the Details tab. */
    guardian: text("guardian"),
    guardianRelationship: text("guardian_relationship"),
    guardianPhone: text("guardian_phone"),
    guardianEmail: text("guardian_email"),
    /** Someone to call in an emergency, in addition to (or instead of) a guardian. */
    emergencyName: text("emergency_name"),
    emergencyRelationship: text("emergency_relationship"),
    emergencyPhone: text("emergency_phone"),
    admittedOn: text("admitted_on"),
    /** When the photo last changed (null: no photo). Also used to bust caches in the photo URL. */
    photoUpdatedAt: timestamp("photo_updated_at", { withTimezone: true }),
    status: residentStatusEnum("status").notNull().default("active"),
    /** Set on discharge (YYYY-MM-DD, home's local date) and cleared on readmission; history is in the audit log. */
    dischargedOn: text("discharged_on"),
    dischargeReason: text("discharge_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("residents_facility_idx").on(t.facilityId), uniqueIndex("residents_wristband_uq").on(t.orgId, t.wristbandCode)],
);

export const orderTypeEnum = pgEnum("order_type", ["scheduled", "prn"]);
export const orderStatusEnum = pgEnum("order_status", ["active", "stopped"]);

export const medicationOrders = pgTable(
  "medication_orders",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    name: text("name").notNull(),
    strength: text("strength").notNull(),
    route: text("route").notNull(),
    purpose: text("purpose").notNull(),
    type: orderTypeEnum("type").notNull(),
    /** Local times of day ("08:00") for scheduled orders, in the home's time zone. */
    times: text("times").array().notNull().default(sql`'{}'::text[]`),
    /** Hold if the top blood pressure number is under 100. */
    bpCheck: boolean("bp_check").notNull().default(false),
    prnReasons: text("prn_reasons").array().notNull().default(sql`'{}'::text[]`),
    prnMinIntervalMinutes: integer("prn_min_interval_minutes"),
    prnMaxPerDay: integer("prn_max_per_day"),
    instructions: text("instructions"),
    prescriber: text("prescriber"),
    /** Barcode on the pharmacy package, if known; scanned during the medication pass. */
    packageCode: text("package_code"),
    /**
     * Tablets (or capsules) on hand, in tenths so half tablets work (295 = 29.5). Null: not counted.
     * Each dose recorded as given takes off doseTenths. Owners and admins only; caregivers never see it.
     */
    countTenths: integer("count_tenths"),
    doseTenths: integer("dose_tenths").notNull().default(10),
    startDate: text("start_date").notNull(),
    stopDate: text("stop_date"),
    status: orderStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    stoppedBy: uuid("stopped_by").references(() => users.id),
    stoppedAt: timestamp("stopped_at", { withTimezone: true }),
    stopReason: text("stop_reason"),
  },
  (t) => [index("orders_resident_idx").on(t.residentId)],
);

export const doseOutcomeEnum = pgEnum("dose_outcome", ["given", "refused", "held"]);

/** One row per dose event. Scheduled doses are unique per order and time slot. */
export const administrations = pgTable(
  "administrations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    orderId: uuid("order_id").notNull().references(() => medicationOrders.id),
    /** The scheduled slot; null for as-needed doses. */
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    outcome: doseOutcomeEnum("outcome").notNull(),
    reason: text("reason"),
    note: text("note"),
    bpSystolic: integer("bp_systolic"),
    bpDiastolic: integer("bp_diastolic"),
    late: boolean("late").notNull().default(false),
    residentScanned: boolean("resident_scanned").notNull(),
    packageScanned: boolean("package_scanned").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("administrations_slot_uq").on(t.orderId, t.scheduledFor).where(sql`${t.scheduledFor} is not null`),
    index("administrations_resident_idx").on(t.residentId, t.recordedAt),
  ],
);

export const followupResultEnum = pgEnum("followup_result", ["effective", "partly_effective", "not_effective"]);

export const prnFollowups = pgTable(
  "prn_followups",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    administrationId: uuid("administration_id").notNull().references(() => administrations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
    result: followupResultEnum("result"),
    note: text("note"),
    recordedBy: uuid("recorded_by").references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }),
  },
  (t) => [index("followups_resident_idx").on(t.residentId)],
);

// ---------------------------------------------------------------- vitals, notes, shifts, diagnoses

/** Permanent once saved. Out-of-range readings carry flags until a nurse reviews them. */
export const vitals = pgTable(
  "vitals",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    systolic: integer("systolic").notNull(),
    diastolic: integer("diastolic").notNull(),
    pulse: integer("pulse").notNull(),
    /** Tenths of a degree Fahrenheit (986 = 98.6 °F), so no floating point. */
    tempTenthsF: integer("temp_tenths_f"),
    /** No longer collected (replaced by blood sugar); kept so earlier readings stay in the record. */
    respirations: integer("respirations"),
    /** Blood sugar (glucose), mg/dL. */
    bloodSugar: integer("blood_sugar"),
    /** How the blood pressure was taken: "sitting" or "lying". */
    bpPosition: text("bp_position"),
    oxygen: integer("oxygen"),
    /** Tenths of a pound. */
    weightTenthsLb: integer("weight_tenths_lb"),
    flags: text("flags").array().notNull().default(sql`'{}'::text[]`),
    note: text("note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    /** Set for entries saved offline: the device's id for the entry, so a retried sync can't duplicate it. */
    clientId: text("client_id"),
  },
  (t) => [index("vitals_resident_idx").on(t.residentId, t.recordedAt), uniqueIndex("vitals_client_uq").on(t.orgId, t.clientId).where(sql`${t.clientId} is not null`)],
);

/** A nurse's review of an out-of-range reading, kept separately so readings stay unchanged. */
export const vitalReviews = pgTable("vital_reviews", {
  vitalId: uuid("vital_id").primaryKey().references(() => vitals.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  reviewedBy: uuid("reviewed_by").notNull().references(() => users.id),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  note: text("note"),
});

export const shiftEnum = pgEnum("shift", ["day", "evening", "night"]);
export const noteCategoryEnum = pgEnum("note_category", ["general", "activity", "health", "behavior", "family_contact"]);

/** Progress notes can't be edited; corrections are addenda that point at the original. */
export const progressNotes = pgTable(
  "progress_notes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    shift: shiftEnum("shift").notNull(),
    category: noteCategoryEnum("category").notNull(),
    body: text("body").notNull(),
    addendumTo: uuid("addendum_to"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    clientId: text("client_id"),
  },
  (t) => [index("notes_resident_idx").on(t.residentId, t.recordedAt), uniqueIndex("notes_client_uq").on(t.orgId, t.clientId).where(sql`${t.clientId} is not null`)],
);

/** Caregivers signing in and out of their shift at a home. */
export const shiftPunches = pgTable(
  "shift_punches",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    signedInAt: timestamp("signed_in_at", { withTimezone: true }).notNull(),
    signedOutAt: timestamp("signed_out_at", { withTimezone: true }),
  },
  (t) => [
    index("punches_user_idx").on(t.userId, t.signedInAt),
    // At most one open shift per person.
    uniqueIndex("punches_open_uq").on(t.userId).where(sql`${t.signedOutAt} is null`),
  ],
);

/**
 * ICD-10-CM reference codes (shared by every organization, read-only for the app). Loaded from the
 * CMS code files each year; `version` is the fiscal year label, e.g. "FY 2027".
 */
export const icd10Codes = pgTable("icd10_codes", {
  code: text("code").primaryKey(),
  description: text("description").notNull(),
  billable: boolean("billable").notNull(),
  version: text("version").notNull(),
});

/**
 * The standard medication list for typeahead when entering orders: NLM RxTerms (free, US), loaded
 * with npm run rx:import. Shared by every organization; read-only for the app. One row per
 * name + strength/form + route.
 */
export const medicationCatalog = pgTable(
  "medication_catalog",
  {
    id: id(),
    /** Generic or brand name, keeping RxTerms' "tall man" lettering (for example hydrOXYzine). */
    name: text("name").notNull(),
    /** Strength and form, for example "10 mg tablet". */
    strength: text("strength").notNull(),
    /** One of the app's routes ("By mouth", "Topical"…), or null when it doesn't map. */
    route: text("route"),
    /** Common abbreviations, for example HCTZ. */
    synonyms: text("synonyms"),
    rxcui: text("rxcui"),
    version: text("version").notNull(),
  },
  (t) => [index("medication_catalog_name_idx").on(sql`lower(${t.name})`), uniqueIndex("medication_catalog_uq").on(t.name, t.strength, t.route)],
);

/** A resident's diagnosis. Removal sets removed_at; rows are never deleted, so history stays. */
export const residentDiagnoses = pgTable(
  "resident_diagnoses",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    code: text("code").notNull(),
    officialDescription: text("official_description").notNull(),
    /** Plain-language name shown to caregivers. */
    label: text("label").notNull(),
    codeSetVersion: text("code_set_version").notNull(),
    addedBy: uuid("added_by").notNull().references(() => users.id),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    removedBy: uuid("removed_by").references(() => users.id),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removeReason: text("remove_reason"),
  },
  (t) => [index("diagnoses_resident_idx").on(t.residentId)],
);

export type Role = (typeof roleEnum.enumValues)[number];
export type Resident = typeof residents.$inferSelect;
export type MedicationOrder = typeof medicationOrders.$inferSelect;
export type Administration = typeof administrations.$inferSelect;
export type User = typeof users.$inferSelect;
export type Facility = typeof facilities.$inferSelect;

// ---------------------------------------------------------------- billing and the public site

/**
 * A PayPal subscription. Created when someone approves a subscription on the public site; linked
 * to an organization once they finish setting it up. Organizations created by the developer
 * (invoiced customers, the first client) have none. PayPal only ever sees the organization's
 * name, the billing contact and the monthly amount, never anything about residents. The quantity
 * is the number of homes; the billing calendar is in lib/billing-cycle.ts.
 */
export const subscriptions = pgTable("subscriptions", {
  id: id(),
  orgId: uuid("org_id").unique().references(() => organizations.id),
  paypalSubscriptionId: text("paypal_subscription_id").notNull().unique(),
  planId: text("plan_id").notNull(),
  /** PayPal's status: APPROVAL_PENDING, APPROVED, ACTIVE, SUSPENDED, CANCELLED or EXPIRED. */
  status: text("status").notNull(),
  quantity: integer("quantity").notNull(),
  payerEmail: text("payer_email"),
  payerName: text("payer_name"),
  nextBillingAt: timestamp("next_billing_at", { withTimezone: true }),
  failedPayments: integer("failed_payments").notNull().default(0),
  /** First failed payment or suspension (cleared when PayPal is paid up). */
  pastDueSince: timestamp("past_due_since", { withTimezone: true }),
  /** An invoice went unpaid past the 10th: admin features pause until it's paid. */
  lateSince: timestamp("late_since", { withTimezone: true }),
  /** PayPal's last successful payment. */
  lastPaymentAt: timestamp("last_payment_at", { withTimezone: true }),
  /** The billing schedule fixed at sign-up (see scheduleFor in lib/billing-cycle.ts). */
  trialEndsOn: text("trial_ends_on"),
  firstCycleEnd: text("first_cycle_end"),
  firstPerHomeCents: integer("first_per_home_cents"),
  introCycles: integer("intro_cycles"),
  startsOn: text("starts_on"),
  /** The day PayPal cancelled the subscription. The billing cycle running then is the last one billed. */
  cancelledOn: text("cancelled_on"),
  /** Single-use link to the organization setup page, emailed to the payer. */
  setupTokenHash: text("setup_token_hash").unique(),
  setupExpiresAt: timestamp("setup_expires_at", { withTimezone: true }),
  setupUsedAt: timestamp("setup_used_at", { withTimezone: true }),
  /** When PayPal needs the payer to approve a new monthly amount. */
  approvalUrl: text("approval_url"),
  /** The "your trial ends soon" email went out (once per subscription). */
  trialReminderSentAt: timestamp("trial_reminder_sent_at", { withTimezone: true }),
  syncedAt: timestamp("synced_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * One invoice per billing cycle, issued the day after the cycle ends. PayPal charges it on the
 * 5th; still unpaid on the 10th, it's late and a late fee is invoiced through PayPal. Once the
 * subscription is cancelled, anything still owed goes out as a PayPal invoice instead.
 * Written only by server code; an organization can read its own.
 */
export const billingInvoices = pgTable(
  "billing_invoices",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    subscriptionId: uuid("subscription_id").notNull().references(() => subscriptions.id),
    /** The days billed: from periodStart to the 28th it ends on. */
    periodStart: text("period_start").notNull(),
    periodEnd: text("period_end").notNull(),
    /** first (prorated), intro or regular */
    stage: text("stage").notNull(),
    homes: integer("homes").notNull(),
    perHomeCents: integer("per_home_cents").notNull(),
    amountCents: integer("amount_cents").notNull(),
    issuedOn: text("issued_on").notNull(),
    dueOn: text("due_on").notNull(),
    lateOn: text("late_on").notNull(),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** The "PayPal takes the payment today" email went out on the due day. */
    remindedAt: timestamp("reminded_at", { withTimezone: true }),
    lateAt: timestamp("late_at", { withTimezone: true }),
    lateFeeCents: integer("late_fee_cents").notNull().default(0),
    /** PayPal's invoice for the late fee, when one was sent. */
    lateFeeInvoiceId: text("late_fee_invoice_id"),
    /** PayPal's invoice for this amount, when the subscription can't collect it (it was cancelled). */
    paypalInvoiceId: text("paypal_invoice_id"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("billing_invoices_cycle_uq").on(t.subscriptionId, t.periodEnd), index("billing_invoices_org_idx").on(t.orgId)],
);

/** Every PayPal webhook received, once each (PayPal retries deliveries). */
export const billingEvents = pgTable("billing_events", {
  id: id(),
  paypalEventId: text("paypal_event_id").notNull().unique(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/** "Request a demo" from the public site. Contact details of prospects, never resident data. */
export const leads = pgTable("leads", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  organization: text("organization").notNull(),
  homes: integer("homes"),
  residents: integer("residents"),
  message: text("message"),
  createdAt: createdAt(),
});
export type Subscription = typeof subscriptions.$inferSelect;
export type BillingInvoice = typeof billingInvoices.$inferSelect;

/**
 * A resident's photo, so caregivers can confirm they have the right person. Kept in the database
 * (same tenant isolation and backups as the rest of the record), re-encoded on upload with all
 * metadata stripped. One per resident; replacing it overwrites the old one.
 */
export const residentPhotos = pgTable("resident_photos", {
  residentId: uuid("resident_id").primaryKey().references(() => residents.id),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  data: bytea("data").notNull(),
  contentType: text("content_type").notNull(),
  updatedBy: uuid("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * An incident report: a fall, injury, behavior incident, medication error and so on. Permanent
 * once filed (like progress notes); everything after that, including who was notified and closing
 * it, is added as a follow-up.
 */
export const incidents = pgTable(
  "incidents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    /** The resident involved, if any. */
    residentId: uuid("resident_id").references(() => residents.id),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    location: text("location"),
    description: text("description").notNull(),
    actionTaken: text("action_taken").notNull(),
    injury: boolean("injury").notNull().default(false),
    injuryDetails: text("injury_details"),
    witnesses: text("witnesses"),
    reportedBy: uuid("reported_by").notNull().references(() => users.id),
    reportedAt: timestamp("reported_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("incidents_facility_idx").on(t.facilityId, t.occurredAt), index("incidents_resident_idx").on(t.residentId, t.occurredAt)],
);

export type Incident = typeof incidents.$inferSelect;

/** Notifications, notes, closing and reopening an incident: added, never changed. */
export const incidentFollowups = pgTable(
  "incident_followups",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    incidentId: uuid("incident_id").notNull().references(() => incidents.id),
    kind: text("kind").notNull(),
    details: text("details"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("incident_followups_incident_idx").on(t.incidentId, t.recordedAt)],
);

/** What the next shift needs to know at a home. Permanent, like progress notes. */
export const handoffNotes = pgTable(
  "handoff_notes",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    shift: shiftEnum("shift").notNull(),
    body: text("body").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("handoff_facility_idx").on(t.facilityId, t.recordedAt)],
);

/** Fire drills and other safety checks at a home. Permanent once recorded. */
export const safetyChecks = pgTable(
  "safety_checks",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    kind: text("kind").notNull(),
    performedAt: timestamp("performed_at", { withTimezone: true }).notNull(),
    shift: shiftEnum("shift"),
    participants: integer("participants"),
    durationMinutes: integer("duration_minutes"),
    issues: text("issues"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("safety_facility_idx").on(t.facilityId, t.kind, t.performedAt)],
);

/** A resident's appointments: doctor, dentist, therapy and so on, and what came of them. */
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    provider: text("provider").notNull(),
    purpose: text("purpose").notNull(),
    location: text("location"),
    notes: text("notes"),
    /** scheduled, done, cancelled or missed. */
    status: text("status").notNull().default("scheduled"),
    outcome: text("outcome"),
    followUp: text("follow_up"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("appointments_resident_idx").on(t.residentId, t.scheduledAt), index("appointments_facility_idx").on(t.facilityId, t.scheduledAt)],
);

/** Staff training and certifications (CPR, first aid, medication certification...) with expiry dates. */
export const staffCertifications = pgTable(
  "staff_certifications",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    kind: text("kind").notNull(),
    label: text("label"),
    issuedOn: text("issued_on"),
    /** YYYY-MM-DD, or null for training that doesn't expire. */
    expiresOn: text("expires_on"),
    notes: text("notes"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
    /** The 30-day and on-expiry reminder emails went out (once each). */
    remindedSoonAt: timestamp("reminded_soon_at", { withTimezone: true }),
    remindedExpiredAt: timestamp("reminded_expired_at", { withTimezone: true }),
  },
  (t) => [index("certifications_user_idx").on(t.userId)],
);

/**
 * Activities of daily living: how much help a resident needed with bathing, dressing, eating and
 * so on, recorded by shift. Permanent once saved (like progress notes); a later entry for the same
 * shift and activity is the one shown.
 */
export const adlEntries = pgTable(
  "adl_entries",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    shift: shiftEnum("shift").notNull(),
    activity: text("activity").notNull(),
    support: text("support").notNull(),
    note: text("note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("adl_resident_idx").on(t.residentId, t.recordedAt)],
);

/**
 * Which activities an organization tracks in daily care. Until an owner or admin changes the list
 * there are no rows and the built-in seven apply. Built-in rows carry their `key`; added ones don't
 * (entries for them store the row's id). Hidden activities keep their history.
 */
export const adlActivities = pgTable(
  "adl_activities",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    key: text("key"),
    name: text("name").notNull(),
    position: integer("position").notNull(),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("adl_activities_org_idx").on(t.orgId, t.position)],
);

/**
 * Photos and scanned documents attached to a progress note (taken with the tablet's camera or a
 * file). Kept in the database like resident photos; images are re-encoded with metadata (GPS
 * included) stripped. Permanent once saved, like the note itself.
 */
export const noteAttachments = pgTable(
  "note_attachments",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    noteId: uuid("note_id").notNull().references(() => progressNotes.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("note_attachments_note_idx").on(t.noteId)],
);

/**
 * Documents kept on a resident's file: admission papers, consents, ID and insurance cards,
 * guardianship papers, signed onboarding forms. Uploaded by owners and admins (or created when an
 * onboarding is admitted). Never deleted: a document added by mistake is marked removed, with
 * who, when and why, and stops showing.
 */
export const residentDocuments = pgTable(
  "resident_documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    residentId: uuid("resident_id").notNull().references(() => residents.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    /** "upload", or "onboarding" for signed forms from an admission. */
    source: text("source").notNull().default("upload"),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
  },
  (t) => [index("resident_documents_resident_idx").on(t.residentId, t.uploadedAt)],
);

/**
 * The forms and documents an organization asks families for when a resident moves in. Each
 * organization starts with general starter forms and edits them or adds its own. A form sent to a
 * family is copied into the onboarding, so later edits never change what was already signed.
 */
export const onboardingForms = pgTable(
  "onboarding_forms",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    /** "form" (fill and sign) or "upload" (documents to send). */
    kind: text("kind").notNull(),
    required: boolean("required").notNull().default(true),
    /** "resident" (a family's move-in paperwork) or "staff" (a new hire's). */
    audience: text("audience").notNull().default("resident"),
    /** Staff forms done on the job: hiring doesn't wait for them. */
    afterHire: boolean("after_hire").notNull().default(false),
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),
    position: integer("position").notNull(),
    version: integer("version").notNull().default(1),
    hiddenAt: timestamp("hidden_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedBy: uuid("updated_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("onboarding_forms_org_idx").on(t.orgId, t.position)],
);

/** Documents on a staff member's file: signed onboarding forms, certificates and uploads. Owners and admins only. */
export const staffDocuments = pgTable(
  "staff_documents",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    category: text("category").notNull(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    /** "upload"; "onboarding" for the employee's signed forms; "onboarding_internal" for the home's own records, never offered to the employee. */
    source: text("source").notNull().default("upload"),
    uploadedBy: uuid("uploaded_by").notNull().references(() => users.id),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
  },
  (t) => [index("staff_documents_user_idx").on(t.userId, t.uploadedAt)],
);

/**
 * One family's onboarding: a future resident, their power of attorney (POA), and a private link.
 * The POA opens the link, confirms a code sent to their email, and works through the checklist.
 * Admitting it creates the resident and files the signed forms.
 */
export const onboardingPackets = pgTable(
  "onboarding_packets",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    facilityId: uuid("facility_id").notNull().references(() => facilities.id),
    residentFirstName: text("resident_first_name").notNull(),
    residentLastName: text("resident_last_name").notNull(),
    poaName: text("poa_name").notNull(),
    poaEmail: text("poa_email").notNull(),
    /** "resident", or "staff" for a new hire: the resident name and POA columns then hold the applicant. */
    audience: text("audience").notNull().default("resident"),
    /** draft, open, admitted (resident), hired (staff) or cancelled. */
    status: text("status").notNull().default("open"),
    /** sha256 of the private link's token; the token itself is only ever in the email. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    residentId: uuid("resident_id").references(() => residents.id),
    /** The staff account a new hire's onboarding created. */
    staffUserId: uuid("staff_user_id").references(() => users.id),
    admittedAt: timestamp("admitted_at", { withTimezone: true }),
    admittedBy: uuid("admitted_by").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBy: uuid("cancelled_by").references(() => users.id),
  },
  (t) => [uniqueIndex("onboarding_packets_token_uq").on(t.tokenHash), index("onboarding_packets_org_idx").on(t.orgId, t.createdAt)],
);

/** One checklist item of an onboarding: a copy of the form as sent, with the answers so far. */
export const onboardingItems = pgTable(
  "onboarding_items",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    packetId: uuid("packet_id").notNull().references(() => onboardingPackets.id),
    formId: uuid("form_id").references(() => onboardingForms.id),
    formVersion: integer("form_version").notNull().default(1),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    kind: text("kind").notNull(),
    required: boolean("required").notNull(),
    afterHire: boolean("after_hire").notNull().default(false),
    blocks: jsonb("blocks").$type<unknown[]>().notNull().default([]),
    position: integer("position").notNull(),
    values: jsonb("values").$type<Record<string, string>>().notNull().default({}),
    /** todo, submitted (by the POA), changes (requested by staff) or approved. */
    status: text("status").notNull().default("todo"),
    staffNote: text("staff_note"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    /** Filled in and signed on paper instead: the home uploaded the signed scan (in onboarding_files). */
    paperAt: timestamp("paper_at", { withTimezone: true }),
    paperBy: uuid("paper_by").references(() => users.id),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [index("onboarding_items_packet_idx").on(t.packetId, t.position)],
);

/** Files the POA uploads for an item (court papers, ID and insurance cards). */
export const onboardingFiles = pgTable(
  "onboarding_files",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    packetId: uuid("packet_id").notNull().references(() => onboardingPackets.id),
    itemId: uuid("item_id").notNull().references(() => onboardingItems.id),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    data: bytea("data").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    removedAt: timestamp("removed_at", { withTimezone: true }),
  },
  (t) => [index("onboarding_files_item_idx").on(t.itemId)],
);

/**
 * Electronic signatures, kept as evidence (ESIGN/UETA): who signed, how, when, from where, and a
 * fingerprint (sha256) of exactly what the form said at that moment. Never deleted; if the form's
 * answers change afterwards the signature is voided and has to be given again.
 */
export const onboardingSignatures = pgTable(
  "onboarding_signatures",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    packetId: uuid("packet_id").notNull().references(() => onboardingPackets.id),
    itemId: uuid("item_id").notNull().references(() => onboardingItems.id),
    blockId: text("block_id").notNull(),
    /** poa or staff. */
    signer: text("signer").notNull(),
    userId: uuid("user_id").references(() => users.id),
    name: text("name").notNull(),
    /** drawn or typed. */
    method: text("method").notNull(),
    image: bytea("image"),
    consent: text("consent").notNull(),
    documentHash: text("document_hash").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    signedAt: timestamp("signed_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
  },
  (t) => [index("onboarding_signatures_item_idx").on(t.itemId)],
);

/** The 6-digit codes emailed to a POA, and the short sessions a correct code starts. */
export const onboardingAccess = pgTable(
  "onboarding_access",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    packetId: uuid("packet_id").notNull().references(() => onboardingPackets.id),
    /** code or session. */
    kind: text("kind").notNull(),
    secretHash: text("secret_hash").notNull(),
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index("onboarding_access_packet_idx").on(t.packetId, t.kind), uniqueIndex("onboarding_access_secret_uq").on(t.secretHash)],
);
