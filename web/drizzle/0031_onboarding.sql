CREATE TABLE "onboarding_access" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"secret_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "onboarding_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"form_id" uuid,
	"form_version" integer DEFAULT 1 NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"kind" text NOT NULL,
	"required" boolean NOT NULL,
	"blocks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"position" integer NOT NULL,
	"values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'todo' NOT NULL,
	"staff_note" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "onboarding_packets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	"resident_first_name" text NOT NULL,
	"resident_last_name" text NOT NULL,
	"poa_name" text NOT NULL,
	"poa_email" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resident_id" uuid,
	"admitted_at" timestamp with time zone,
	"admitted_by" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" uuid
);
--> statement-breakpoint
CREATE TABLE "onboarding_signatures" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"packet_id" uuid NOT NULL,
	"item_id" uuid NOT NULL,
	"block_id" text NOT NULL,
	"signer" text NOT NULL,
	"user_id" uuid,
	"name" text NOT NULL,
	"method" text NOT NULL,
	"image" "bytea",
	"consent" text NOT NULL,
	"document_hash" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"signed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "onboarding_access" ADD CONSTRAINT "onboarding_access_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_access" ADD CONSTRAINT "onboarding_access_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_files" ADD CONSTRAINT "onboarding_files_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_files" ADD CONSTRAINT "onboarding_files_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_files" ADD CONSTRAINT "onboarding_files_item_id_onboarding_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."onboarding_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_form_id_onboarding_forms_id_fk" FOREIGN KEY ("form_id") REFERENCES "public"."onboarding_forms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_admitted_by_users_id_fk" FOREIGN KEY ("admitted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_cancelled_by_users_id_fk" FOREIGN KEY ("cancelled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_signatures" ADD CONSTRAINT "onboarding_signatures_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_signatures" ADD CONSTRAINT "onboarding_signatures_packet_id_onboarding_packets_id_fk" FOREIGN KEY ("packet_id") REFERENCES "public"."onboarding_packets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_signatures" ADD CONSTRAINT "onboarding_signatures_item_id_onboarding_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."onboarding_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "onboarding_signatures" ADD CONSTRAINT "onboarding_signatures_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "onboarding_access_packet_idx" ON "onboarding_access" USING btree ("packet_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_access_secret_uq" ON "onboarding_access" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "onboarding_files_item_idx" ON "onboarding_files" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "onboarding_items_packet_idx" ON "onboarding_items" USING btree ("packet_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "onboarding_packets_token_uq" ON "onboarding_packets" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "onboarding_packets_org_idx" ON "onboarding_packets" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "onboarding_signatures_item_idx" ON "onboarding_signatures" USING btree ("item_id");--> statement-breakpoint
-- Onboarding records are kept; nothing is deleted. Signatures are only ever inserted, or voided.
GRANT SELECT, INSERT, UPDATE ON onboarding_packets, onboarding_items, onboarding_files, onboarding_signatures, onboarding_access TO app_user;--> statement-breakpoint
REVOKE DELETE ON onboarding_packets, onboarding_items, onboarding_files, onboarding_signatures, onboarding_access FROM app_user;--> statement-breakpoint
ALTER TABLE onboarding_packets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_packets USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE onboarding_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_items USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE onboarding_files ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_files USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE onboarding_signatures ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_signatures USING (org_id = current_org()) WITH CHECK (org_id = current_org());--> statement-breakpoint
ALTER TABLE onboarding_access ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON onboarding_access USING (org_id = current_org()) WITH CHECK (org_id = current_org());
