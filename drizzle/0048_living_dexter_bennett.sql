CREATE TABLE "human_projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"deadline" timestamp with time zone,
	"lead_member_id" uuid,
	"manager_member_id" uuid,
	"source" text DEFAULT 'manual' NOT NULL,
	"source_project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_assignments" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD COLUMN "created_by_member_id" uuid;--> statement-breakpoint
ALTER TABLE "human_projects" ADD CONSTRAINT "human_projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "human_projects_ws_idx" ON "human_projects" USING btree ("workspace_id","created_at");