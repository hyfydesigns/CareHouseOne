CREATE TABLE "adl_activities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"key" text,
	"name" text NOT NULL,
	"position" integer NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adl_activities" ADD CONSTRAINT "adl_activities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adl_activities" ADD CONSTRAINT "adl_activities_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adl_activities_org_idx" ON "adl_activities" USING btree ("org_id","position");--> statement-breakpoint
-- Owners and admins add and hide activities; nothing is deleted, so history keeps its names.
GRANT SELECT, INSERT, UPDATE ON adl_activities TO app_user;--> statement-breakpoint
REVOKE DELETE ON adl_activities FROM app_user;--> statement-breakpoint
ALTER TABLE adl_activities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON adl_activities USING (org_id = current_org()) WITH CHECK (org_id = current_org());
