ALTER TABLE "business_briefs" ADD COLUMN "email_signature_block" jsonb;--> statement-breakpoint
ALTER TABLE "email_settings" ADD COLUMN "signature_block" jsonb;