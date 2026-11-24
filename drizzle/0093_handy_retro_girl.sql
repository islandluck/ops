CREATE TABLE "networking_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"goal" text DEFAULT '' NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "networking_block_event_id" text;--> statement-breakpoint
ALTER TABLE "networking_targets" ADD COLUMN "goal_id" uuid;--> statement-breakpoint
ALTER TABLE "networking_goals" ADD CONSTRAINT "networking_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "networking_goals_ws_idx" ON "networking_goals" USING btree ("workspace_id","status");--> statement-breakpoint
ALTER TABLE "networking_targets" ADD CONSTRAINT "networking_targets_goal_id_networking_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."networking_goals"("id") ON DELETE set null ON UPDATE no action;