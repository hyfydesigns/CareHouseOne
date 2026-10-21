CREATE TABLE "device_facilities" (
	"org_id" uuid NOT NULL,
	"device_id" uuid NOT NULL,
	"facility_id" uuid NOT NULL,
	CONSTRAINT "device_facilities_device_id_facility_id_pk" PRIMARY KEY("device_id","facility_id")
);
--> statement-breakpoint
ALTER TABLE "devices" DROP CONSTRAINT "devices_facility_id_facilities_id_fk";
--> statement-breakpoint
ALTER TABLE "device_facilities" ADD CONSTRAINT "device_facilities_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_facilities" ADD CONSTRAINT "device_facilities_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "device_facilities" ADD CONSTRAINT "device_facilities_facility_id_facilities_id_fk" FOREIGN KEY ("facility_id") REFERENCES "public"."facilities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Each existing tablet keeps its one home.
INSERT INTO "device_facilities" ("org_id", "device_id", "facility_id") SELECT "org_id", "id", "facility_id" FROM "devices";--> statement-breakpoint
ALTER TABLE "devices" DROP COLUMN "facility_id";--> statement-breakpoint
-- Same tenant isolation as the other tables; owners and admins add and remove a tablet's homes.
GRANT SELECT, INSERT, DELETE ON device_facilities TO app_user;--> statement-breakpoint
REVOKE UPDATE ON device_facilities FROM app_user;--> statement-breakpoint
ALTER TABLE device_facilities ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON device_facilities USING (org_id = current_org()) WITH CHECK (org_id = current_org());