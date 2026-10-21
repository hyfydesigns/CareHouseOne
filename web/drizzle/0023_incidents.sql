CREATE TABLE "incident_followups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"details" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"resident_id" uuid,
	"type" text NOT NULL,
	"severity" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"description" text NOT NULL,
	"action_taken" text NOT NULL,
	"injury" boolean DEFAULT false NOT NULL,
	"injury_details" text,
	"witnesses" text,
	"reported_by" uuid NOT NULL,
	"reported_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "incident_followups" ADD CONSTRAINT "incident_followups_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_followups" ADD CONSTRAINT "incident_followups_incident_id_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."incidents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_followups" ADD CONSTRAINT "incident_followups_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incidents" ADD CONSTRAINT "incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "incident_followups_incident_idx" ON "incident_followups" USING btree ("incident_id","recorded_at");--> statement-breakpoint
CREATE INDEX "incidents_facility_idx" ON "incidents" USING btree ("facility_id","occurred_at");--> statement-breakpoint
CREATE INDEX "incidents_resident_idx" ON "incidents" USING btree ("resident_id","occurred_at");--> statement-breakpoint
-- Incident reports are permanent: filed and followed up, never changed or deleted.
GRANT SELECT, INSERT ON incidents, incident_followups TO app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE ON incidents, incident_followups FROM app_user;--> statement-breakpoint
ALTER TABLE incidents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON incidents USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE incident_followups ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON incident_followups USING (org_id = current_org()) WITH CHECK (org_id = current_org());
