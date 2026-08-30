ALTER TABLE "business_briefs" ADD COLUMN "digest_cadence" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "digest_last_sent_at" timestamp with time zone;