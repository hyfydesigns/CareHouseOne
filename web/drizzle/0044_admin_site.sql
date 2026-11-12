CREATE TABLE "admin_audit" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"admin_id" uuid,
	"org_id" uuid,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"mfa_passed" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"signer_name" text NOT NULL,
	"signer_email" text NOT NULL,
	"document" jsonb NOT NULL,
	"version" text NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"viewed_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	"signed_at" timestamp with time zone,
	"signed_name" text,
	"signed_title" text,
	"sign_method" text,
	"signature_image" text,
	"signer_ip" text,
	"signer_user_agent" text,
	"document_hash" text,
	"voided_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contracts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "platform_admins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text,
	"mfa_secret_enc" text NOT NULL,
	"failed_logins" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"setup_token_hash" text,
	"setup_expires_at" timestamp with time zone,
	"last_sign_in_at" timestamp with time zone,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_admins_email_unique" UNIQUE("email"),
	CONSTRAINT "platform_admins_setup_token_hash_unique" UNIQUE("setup_token_hash")
);
--> statement-breakpoint
ALTER TABLE "subscriptions" ALTER COLUMN "paypal_subscription_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "status" text DEFAULT 'new' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "org_id" uuid;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "billing_method" text DEFAULT 'paypal' NOT NULL;--> statement-breakpoint
ALTER TABLE "admin_sessions" ADD CONSTRAINT "admin_sessions_admin_id_platform_admins_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_created_by_platform_admins_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."platform_admins"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_audit_org_at_idx" ON "admin_audit" USING btree ("org_id","at");--> statement-breakpoint
CREATE INDEX "contracts_org_idx" ON "contracts" USING btree ("org_id");--> statement-breakpoint
-- The admin site's tables are for the server only: no organization can see or change them.
REVOKE ALL ON platform_admins FROM app_user;--> statement-breakpoint
REVOKE ALL ON admin_sessions FROM app_user;--> statement-breakpoint
REVOKE ALL ON admin_audit FROM app_user;--> statement-breakpoint
REVOKE ALL ON admin_audit_id_seq FROM app_user;--> statement-breakpoint
REVOKE ALL ON contracts FROM app_user;
