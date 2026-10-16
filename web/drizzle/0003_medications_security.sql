-- Tenant isolation for residents and medication records (same pattern as 0001_security.sql).
GRANT SELECT, INSERT, UPDATE, DELETE ON residents, medication_orders, administrations, prn_followups TO app_user;
--> statement-breakpoint
ALTER TABLE residents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON residents USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE medication_orders ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON medication_orders USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE administrations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON administrations USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE prn_followups ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON prn_followups USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
-- Dose records are permanent: the request role can add them but never edit or delete them.
-- Corrections are new entries (a later stage adds documented corrections).
REVOKE UPDATE, DELETE ON administrations FROM app_user;
