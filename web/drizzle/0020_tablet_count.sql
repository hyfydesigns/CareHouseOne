ALTER TABLE "medication_orders" ADD COLUMN "count_tenths" integer;--> statement-breakpoint
ALTER TABLE "medication_orders" ADD COLUMN "dose_tenths" integer DEFAULT 10 NOT NULL;