ALTER TABLE "business_briefs" ADD COLUMN "email_open_tracking" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "tracking_token" text;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "opened_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "open_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "last_opened_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "outbound_drafts_token_uniq" ON "outbound_drafts" USING btree ("tracking_token");