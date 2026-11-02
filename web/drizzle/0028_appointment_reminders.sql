ALTER TABLE "organizations" ADD COLUMN "appointment_reminders" text DEFAULT 'evening' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "appointment_digest_on" text;