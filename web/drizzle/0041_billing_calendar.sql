CREATE TABLE "billing_invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"period_start" text NOT NULL,
	"period_end" text NOT NULL,
	"stage" text NOT NULL,
	"homes" integer NOT NULL,
	"per_home_cents" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"issued_on" text NOT NULL,
	"due_on" text NOT NULL,
	"late_on" text NOT NULL,
	"paid_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"late_at" timestamp with time zone,
	"late_fee_cents" integer DEFAULT 0 NOT NULL,
	"late_fee_invoice_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "late_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "last_payment_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "trial_ends_on" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "first_cycle_end" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "first_per_home_cents" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "intro_cycles" integer;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "starts_on" text;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "billing_invoices" ADD CONSTRAINT "billing_invoices_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "billing_invoices_cycle_uq" ON "billing_invoices" USING btree ("subscription_id","period_end");--> statement-breakpoint
CREATE INDEX "billing_invoices_org_idx" ON "billing_invoices" USING btree ("org_id");--> statement-breakpoint
-- Invoices are written only by server code outside a tenant (housekeeping, PayPal webhooks).
-- Inside a tenant an organization can read its own for the Settings billing screen.
REVOKE INSERT, UPDATE, DELETE ON billing_invoices FROM app_user;
--> statement-breakpoint
ALTER TABLE billing_invoices ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON billing_invoices USING (org_id = current_org());
