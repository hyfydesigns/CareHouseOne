-- Production on Cloud SQL (PostgreSQL 16 or newer): the app's login role created app_user, but
-- since PostgreSQL 16 the creator isn't automatically allowed to SET ROLE to it. withTenant()
-- needs that, so grant the membership explicitly. Harmless where it already exists.
DO $$ BEGIN
  EXECUTE format('GRANT app_user TO %I', current_user);
END $$;
--> statement-breakpoint
-- Rate-limit counters are only touched outside a tenant (before anyone is signed in).
REVOKE ALL ON rate_limits FROM app_user;
