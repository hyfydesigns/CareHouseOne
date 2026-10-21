CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"provider" text NOT NULL,
	"purpose" text NOT NULL,
	"location" text,
	"notes" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"outcome" text,
	"follow_up" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "handoff_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"shift" "shift" NOT NULL,
	"body" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"performed_at" timestamp with time zone NOT NULL,
	"shift" "shift",
	"participants" integer,
	"duration_minutes" integer,
	"issues" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_certifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"label" text,
	"issued_on" text,
	"expires_on" text,
	"notes" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"reminded_soon_at" timestamp with time zone,
	"reminded_expired_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoff_notes" ADD CONSTRAINT "handoff_notes_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_checks" ADD CONSTRAINT "safety_checks_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_certifications" ADD CONSTRAINT "staff_certifications_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_resident_idx" ON "appointments" USING btree ("resident_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "appointments_facility_idx" ON "appointments" USING btree ("facility_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "handoff_facility_idx" ON "handoff_notes" USING btree ("facility_id","recorded_at");--> statement-breakpoint
CREATE INDEX "safety_facility_idx" ON "safety_checks" USING btree ("facility_id","kind","performed_at");--> statement-breakpoint
CREATE INDEX "certifications_user_idx" ON "staff_certifications" USING btree ("user_id");--> statement-breakpoint
-- Handoff notes and safety checks are permanent; appointments and certifications can be updated (status, outcome, removal) but not deleted.
GRANT SELECT, INSERT ON handoff_notes, safety_checks TO app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE ON handoff_notes, safety_checks FROM app_user;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON appointments, staff_certifications TO app_user;--> statement-breakpoint
REVOKE DELETE ON appointments, staff_certifications FROM app_user;--> statement-breakpoint
ALTER TABLE handoff_notes ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON handoff_notes USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE safety_checks ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON safety_checks USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE appointments ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON appointments USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE staff_certifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_certifications USING (org_id = current_org()) WITH CHECK (org_id = current_org());
