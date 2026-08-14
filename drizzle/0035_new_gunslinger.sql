ALTER TABLE "outbound_drafts" ADD COLUMN "cc" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "bcc" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "scheduled_at" timestamp with time zone;