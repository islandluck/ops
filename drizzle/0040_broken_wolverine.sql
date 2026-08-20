CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"audience" text DEFAULT '' NOT NULL,
	"daily_budget_cents" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"format" text DEFAULT '' NOT NULL,
	"headline" text DEFAULT '' NOT NULL,
	"primary_text" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"cta" text DEFAULT '' NOT NULL,
	"keywords" jsonb,
	"audience" text DEFAULT '' NOT NULL,
	"geo" text DEFAULT '' NOT NULL,
	"image_url" text DEFAULT '' NOT NULL,
	"image_alt" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_creatives" ADD CONSTRAINT "ad_creatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ad_campaigns_ws_idx" ON "ad_campaigns" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "ad_creatives_campaign_idx" ON "ad_creatives" USING btree ("campaign_id");