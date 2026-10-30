CREATE TABLE "adl_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"resident_id" uuid NOT NULL,
	"shift" "shift" NOT NULL,
	"activity" text NOT NULL,
	"support" text NOT NULL,
	"note" text,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adl_entries" ADD CONSTRAINT "adl_entries_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adl_entries" ADD CONSTRAINT "adl_entries_resident_id_residents_id_fk" FOREIGN KEY ("resident_id") REFERENCES "public"."residents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adl_entries" ADD CONSTRAINT "adl_entries_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adl_resident_idx" ON "adl_entries" USING btree ("resident_id","recorded_at");--> statement-breakpoint
-- ADL entries are permanent: recorded, never changed or deleted.
GRANT SELECT, INSERT ON adl_entries TO app_user;--> statement-breakpoint
REVOKE UPDATE, DELETE ON adl_entries FROM app_user;--> statement-breakpoint
ALTER TABLE adl_entries ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON adl_entries USING (org_id = current_org()) WITH CHECK (org_id = current_org());
