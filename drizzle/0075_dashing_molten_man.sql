ALTER TABLE "quote_suppliers" ADD COLUMN "contact_method" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "quote_suppliers" ADD COLUMN "contact_url" text;