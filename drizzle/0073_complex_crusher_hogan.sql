CREATE TABLE "marketing_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"objective" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid,
	"channel" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body_md" text DEFAULT '' NOT NULL,
	"image_url" text,
	"status" text DEFAULT 'drafted' NOT NULL,
	"scheduled_at" timestamp with time zone,
	"ref_type" text,
	"ref_id" uuid,
	"ref_url" text,
	"posted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pages" ADD COLUMN "publish_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_items" ADD CONSTRAINT "marketing_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_items" ADD CONSTRAINT "marketing_items_campaign_id_marketing_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."marketing_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "marketing_campaigns_ws_idx" ON "marketing_campaigns" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "marketing_items_ws_sched_idx" ON "marketing_items" USING btree ("workspace_id","scheduled_at");--> statement-breakpoint
CREATE INDEX "marketing_items_ws_campaign_idx" ON "marketing_items" USING btree ("workspace_id","campaign_id");