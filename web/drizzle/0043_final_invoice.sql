ALTER TABLE "billing_invoices" ADD COLUMN "paypal_invoice_id" text;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD COLUMN "cancelled_on" text;