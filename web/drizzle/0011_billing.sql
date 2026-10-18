CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paypal_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"resource_id" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "billing_events_paypal_event_id_unique" UNIQUE("paypal_event_id")
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"organization" text NOT NULL,
	"homes" integer,
	"residents" integer,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"paypal_subscription_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"status" text NOT NULL,
	"quantity" integer NOT NULL,
	"payer_email" text,
	"payer_name" text,
	"next_billing_at" timestamp with time zone,
	"failed_payments" integer DEFAULT 0 NOT NULL,
	"past_due_since" timestamp with time zone,
	"setup_token_hash" text,
	"setup_expires_at" timestamp with time zone,
	"setup_used_at" timestamp with time zone,
	"approval_url" text,
	"quantity_synced_month" text,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_org_id_unique" UNIQUE("org_id"),
	CONSTRAINT "subscriptions_paypal_subscription_id_unique" UNIQUE("paypal_subscription_id"),
	CONSTRAINT "subscriptions_setup_token_hash_unique" UNIQUE("setup_token_hash")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;