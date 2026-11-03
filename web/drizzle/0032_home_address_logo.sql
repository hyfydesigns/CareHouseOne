ALTER TABLE "facilities" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "zip" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "fax" text;--> statement-breakpoint
ALTER TABLE "facilities" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "logo" "bytea";