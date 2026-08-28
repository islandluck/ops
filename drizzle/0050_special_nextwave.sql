CREATE TABLE "team_goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"horizon" text DEFAULT 'month' NOT NULL,
	"scope" text DEFAULT 'team' NOT NULL,
	"member_id" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_goals" ADD CONSTRAINT "team_goals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_goals_ws_idx" ON "team_goals" USING btree ("workspace_id");