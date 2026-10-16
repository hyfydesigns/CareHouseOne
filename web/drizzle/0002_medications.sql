CREATE TYPE "public"."dose_outcome" AS ENUM('given', 'refused', 'held');--> statement-breakpoint
CREATE TYPE "public"."followup_result" AS ENUM('effective', 'partly_effective', 'not_effective');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('active', 'stopped');--> statement-breakpoint
CREATE TYPE "public"."order_type" AS ENUM('scheduled', 'prn');--> statement-breakpoint
CREATE TYPE "public"."resident_status" AS ENUM('active', 'discharged');--> statement-breakpoint
CREATE TABLE "administrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"scheduled_for" timestamp with time zone,
	"outcome" "dose_outcome" NOT NULL,
	"reason" text,
	"note" text,
	"bp_systolic" integer,
	"bp_diastolic" integer,
	"late" boolean DEFAULT false NOT NULL,
	"resident_scanned" boolean NOT NULL,
	"package_scanned" boolean NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "medication_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"name" text NOT NULL,
	"strength" text NOT NULL,
	"route" text NOT NULL,
	"purpose" text NOT NULL,
	"type" "order_type" NOT NULL,
	"times" text[] DEFAULT '{}'::text[] NOT NULL,
	"bp_check" boolean DEFAULT false NOT NULL,
	"prn_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"prn_min_interval_minutes" integer,
	"prn_max_per_day" integer,
	"instructions" text,
	"prescriber" text,
	"package_code" text,
	"start_date" text NOT NULL,
	"stop_date" text,
	"status" "order_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_by" uuid,
	"stopped_at" timestamp with time zone,
	"stop_reason" text
);
--> statement-breakpoint
CREATE TABLE "prn_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"administration_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"result" "followup_result",
	"note" text,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "residents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"room" text DEFAULT '' NOT NULL,
	"date_of_birth" text,
	"wristband_code" text NOT NULL,
	"allergies" text[] DEFAULT '{}'::text[] NOT NULL,
	"diet" text DEFAULT 'Regular' NOT NULL,
	"code_status" text DEFAULT 'Full code' NOT NULL,
	"guardian" text,
	"admitted_on" text,
	"status" "resident_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "administrations" ADD CONSTRAINT "administrations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrations" ADD CONSTRAINT "administrations_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrations" ADD CONSTRAINT "administrations_order_id_medication_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."medication_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "administrations" ADD CONSTRAINT "administrations_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD CONSTRAINT "medication_orders_stopped_by_users_id_fk" FOREIGN KEY ("stopped_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prn_followups" ADD CONSTRAINT "prn_followups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prn_followups" ADD CONSTRAINT "prn_followups_administration_id_administrations_id_fk" FOREIGN KEY ("administration_id") REFERENCES "public"."administrations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prn_followups" ADD CONSTRAINT "prn_followups_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prn_followups" ADD CONSTRAINT "prn_followups_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "residents" ADD CONSTRAINT "residents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "administrations_slot_uq" ON "administrations" USING btree ("order_id","scheduled_for") WHERE "administrations"."scheduled_for" is not null;--> statement-breakpoint
CREATE INDEX "administrations_resident_idx" ON "administrations" USING btree ("resident_id","recorded_at");--> statement-breakpoint
CREATE INDEX "orders_resident_idx" ON "medication_orders" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "followups_resident_idx" ON "prn_followups" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "residents_facility_idx" ON "residents" USING btree ("facility_id");--> statement-breakpoint
CREATE UNIQUE INDEX "residents_wristband_uq" ON "residents" USING btree ("org_id","wristband_code");