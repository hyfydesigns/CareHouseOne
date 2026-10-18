-- Billing is written only by server code outside a tenant (PayPal webhooks, sign-up, housekeeping).
-- Inside a tenant an organization can read its own subscription for the Settings billing screen.
REVOKE INSERT, UPDATE, DELETE ON subscriptions FROM app_user;
--> statement-breakpoint
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON subscriptions USING (org_id = current_org());
--> statement-breakpoint
-- The PayPal event log and demo requests belong to no organization.
REVOKE ALL ON billing_events FROM app_user;
--> statement-breakpoint
REVOKE ALL ON leads FROM app_user;
