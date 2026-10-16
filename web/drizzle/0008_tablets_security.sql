-- Registered tablets and per-device PINs (same tenant isolation as earlier migrations).
GRANT SELECT, INSERT, UPDATE ON devices TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON device_pins TO app_user;
--> statement-breakpoint
REVOKE DELETE ON devices FROM app_user;
--> statement-breakpoint
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON devices USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE device_pins ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON device_pins USING (org_id = current_org()) WITH CHECK (org_id = current_org());
