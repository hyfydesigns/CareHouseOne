CREATE TABLE "medication_catalog" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"strength" text NOT NULL,
	"route" text,
	"synonyms" text,
	"rxcui" text,
	"version" text NOT NULL
);
--> statement-breakpoint
CREATE INDEX "medication_catalog_name_idx" ON "medication_catalog" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "medication_catalog_uq" ON "medication_catalog" USING btree ("name","strength","route");