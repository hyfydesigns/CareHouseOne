CREATE TABLE "resident_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
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
ALTER TABLE "resident_documents" ADD CONSTRAINT "resident_documents_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_documents" ADD CONSTRAINT "resident_documents_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_documents" ADD CONSTRAINT "resident_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "resident_documents" ADD CONSTRAINT "resident_documents_removed_by_users_id_fk" FOREIGN KEY ("removed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resident_documents_resident_idx" ON "resident_documents" USING btree ("resident_id","uploaded_at");--> statement-breakpoint
-- Documents are never deleted; UPDATE is only for marking one removed.
GRANT SELECT, INSERT, UPDATE ON resident_documents TO app_user;--> statement-breakpoint
REVOKE DELETE ON resident_documents FROM app_user;--> statement-breakpoint
ALTER TABLE resident_documents ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON resident_documents USING (org_id = current_org()) WITH CHECK (org_id = current_org());
