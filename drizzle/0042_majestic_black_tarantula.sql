CREATE TABLE "ad_placements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"platform" text DEFAULT 'x' NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"external_campaign_id" text DEFAULT '' NOT NULL,
	"external_line_item_id" text DEFAULT '' NOT NULL,
	"external_tweet_id" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"spend_cents" integer DEFAULT 0 NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_creative_id_ad_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."ad_creatives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_placements" ADD CONSTRAINT "ad_placements_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_placements_ws_idx" ON "ad_placements" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ad_placements_creative_idx" ON "ad_placements" USING btree ("creative_id");