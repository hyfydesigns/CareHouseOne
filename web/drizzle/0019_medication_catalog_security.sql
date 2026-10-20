-- The medication list is shared reference data, like the ICD-10-CM codes: the app only reads it.
REVOKE INSERT, UPDATE, DELETE ON medication_catalog FROM app_user;
--> statement-breakpoint
GRANT SELECT ON medication_catalog TO app_user;
