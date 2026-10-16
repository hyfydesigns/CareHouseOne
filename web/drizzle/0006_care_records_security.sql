-- Tenant isolation and permanence for stage 3 records (same pattern as 0001 and 0003).
GRANT SELECT, INSERT ON vitals, progress_notes, vital_reviews TO app_user;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON shift_punches, resident_diagnoses TO app_user;
--> statement-breakpoint
-- Readings and notes are permanent; diagnoses and shifts can be updated (removal, sign-out) but never deleted.
REVOKE UPDATE, DELETE ON vitals, progress_notes, vital_reviews FROM app_user;
--> statement-breakpoint
REVOKE DELETE ON shift_punches, resident_diagnoses FROM app_user;
--> statement-breakpoint
-- The ICD-10-CM reference table is shared and read-only for requests.
REVOKE INSERT, UPDATE, DELETE ON icd10_codes FROM app_user;
--> statement-breakpoint
GRANT SELECT ON icd10_codes TO app_user;
--> statement-breakpoint
ALTER TABLE vitals ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON vitals USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE vital_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON vital_reviews USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE progress_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON progress_notes USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE shift_punches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON shift_punches USING (org_id = current_org()) WITH CHECK (org_id = current_org());
--> statement-breakpoint
ALTER TABLE resident_diagnoses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON resident_diagnoses USING (org_id = current_org()) WITH CHECK (org_id = current_org());
