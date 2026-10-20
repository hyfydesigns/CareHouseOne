-- Resident photos: same tenant isolation as the rest of the record.
ALTER TABLE resident_photos ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON resident_photos USING (org_id = current_org()) WITH CHECK (org_id = current_org());
