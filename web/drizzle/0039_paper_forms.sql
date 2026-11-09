ALTER TABLE "onboarding_items" ADD COLUMN "paper_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD COLUMN "paper_by" uuid;--> statement-breakpoint
ALTER TABLE "onboarding_items" ADD CONSTRAINT "onboarding_items_paper_by_users_id_fk" FOREIGN KEY ("paper_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;