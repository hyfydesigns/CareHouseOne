CREATE TABLE "onboarding_forms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"hidden_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "onboarding_forms" ADD CONSTRAINT "onboarding_forms_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_forms" ADD CONSTRAINT "onboarding_forms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_forms" ADD CONSTRAINT "onboarding_forms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_forms_org_idx" ON "onboarding_forms" USING btree ("org_id","position");--> statement-breakpoint
-- Owners and admins add, edit and hide forms; nothing is deleted.
GRANT SELECT, INSERT, UPDATE ON onboarding_forms TO app_user;--> statement-breakpoint
REVOKE DELETE ON onboarding_forms FROM app_user;--> statement-breakpoint
ALTER TABLE onboarding_forms ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_forms USING (org_id = current_org()) WITH CHECK (org_id = current_org());
