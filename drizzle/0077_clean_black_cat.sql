ALTER TABLE "outreach_campaigns" ADD COLUMN "auto_find_emails" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "outreach_contacts" ADD COLUMN "email_meta" text;