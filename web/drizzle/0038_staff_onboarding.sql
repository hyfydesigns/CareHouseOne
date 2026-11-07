CREATE TABLE "staff_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"data" "bytea" NOT NULL,
	"source" text DEFAULT 'upload' NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"uploaded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by" uuid,
	"removed_reason" text
);
--> statement-breakpoint
ALTER TABLE "onboarding_forms" ADD COLUMN "audience" text DEFAULT 'resident' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_forms" ADD COLUMN "after_hire" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD COLUMN "after_hire" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD COLUMN "audience" text DEFAULT 'resident' NOT NULL;--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD COLUMN "staff_user_id" uuid;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_documents" ADD CONSTRAINT "staff_documents_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_documents_user_idx" ON "staff_documents" USING btree ("user_id","uploaded_at");--> statement-breakpoint
ALTER TABLE "onboarding_packets" ADD CONSTRAINT "onboarding_packets_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;;--> statement-breakpoint
-- Documents are never deleted; UPDATE is only for marking one removed.
GRANT SELECT, INSERT, UPDATE ON staff_documents TO app_user;--> statement-breakpoint
REVOKE DELETE ON staff_documents FROM app_user;--> statement-breakpoint
ALTER TABLE staff_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON staff_documents USING (org_id = current_org()) WITH CHECK (org_id = current_org());
