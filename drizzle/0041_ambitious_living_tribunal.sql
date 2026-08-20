ALTER TABLE "ad_campaigns" ADD COLUMN "destination_url" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "status" text DEFAULT 'draft' NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD COLUMN "placement_ref" text DEFAULT '' NOT NULL;