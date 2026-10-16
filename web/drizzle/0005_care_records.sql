CREATE TYPE "public"."note_category" AS ENUM('general', 'activity', 'health', 'behavior', 'family_contact');--> statement-breakpoint
CREATE TYPE "public"."shift" AS ENUM('day', 'evening', 'night');--> statement-breakpoint
CREATE TABLE "icd10_codes" (
	"code" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL,
	"billable" boolean NOT NULL,
	"version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"shift" "shift" NOT NULL,
	"category" "note_category" NOT NULL,
	"body" text NOT NULL,
	"addendum_to" uuid,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resident_diagnoses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"code" text NOT NULL,
	"official_description" text NOT NULL,
	"label" text NOT NULL,
	"code_set_version" text NOT NULL,
	"added_by" uuid NOT NULL,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_by" uuid,
	"removed_at" timestamp with time zone,
	"remove_reason" text
);
--> statement-breakpoint
CREATE TABLE "shift_punches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"signed_in_at" timestamp with time zone NOT NULL,
	"signed_out_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "vital_reviews" (
	"vital_id" uuid PRIMARY KEY NOT NULL,
	"org_id" uuid NOT NULL,
	"reviewed_by" uuid NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "vitals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"systolic" integer NOT NULL,
	"diastolic" integer NOT NULL,
	"pulse" integer NOT NULL,
	"temp_tenths_f" integer,
	"respirations" integer,
	"oxygen" integer,
	"weight_tenths_lb" integer,
	"flags" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_notes" ADD CONSTRAINT "progress_notes_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_diagnoses" ADD CONSTRAINT "resident_diagnoses_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_diagnoses" ADD CONSTRAINT "resident_diagnoses_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_diagnoses" ADD CONSTRAINT "resident_diagnoses_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_diagnoses" ADD CONSTRAINT "resident_diagnoses_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_punches" ADD CONSTRAINT "shift_punches_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_punches" ADD CONSTRAINT "shift_punches_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_punches" ADD CONSTRAINT "shift_punches_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reviews" ADD CONSTRAINT "vital_reviews_vital_id_vitals_id_fk" FOREIGN KEY ("vital_id") REFERENCES "public"."vitals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reviews" ADD CONSTRAINT "vital_reviews_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vital_reviews" ADD CONSTRAINT "vital_reviews_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notes_resident_idx" ON "progress_notes" USING btree ("resident_id","recorded_at");--> statement-breakpoint
CREATE INDEX "diagnoses_resident_idx" ON "resident_diagnoses" USING btree ("resident_id");--> statement-breakpoint
CREATE INDEX "punches_user_idx" ON "shift_punches" USING btree ("user_id","signed_in_at");--> statement-breakpoint
CREATE UNIQUE INDEX "punches_open_uq" ON "shift_punches" USING btree ("user_id") WHERE "shift_punches"."signed_out_at" is null;--> statement-breakpoint
CREATE INDEX "vitals_resident_idx" ON "vitals" USING btree ("resident_id","recorded_at");