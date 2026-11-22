CREATE TABLE "operating_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deep_dive_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"content" jsonb DEFAULT '{"headline":"","moved":[],"kpi_read":"","risks":[],"opportunities":[],"actions":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "deep_dive_cadence" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "deep_dive_last_review_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "deep_dives" ADD COLUMN "mode" text DEFAULT 'context' NOT NULL;--> statement-breakpoint
ALTER TABLE "operating_reviews" ADD CONSTRAINT "operating_reviews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operating_reviews" ADD CONSTRAINT "operating_reviews_deep_dive_id_deep_dives_id_fk" FOREIGN KEY ("deep_dive_id") REFERENCES "public"."deep_dives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operating_reviews_ws_current_idx" ON "operating_reviews" USING btree ("workspace_id","is_current");