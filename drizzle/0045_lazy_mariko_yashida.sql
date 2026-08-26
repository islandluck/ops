CREATE TABLE "task_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"groups" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_group" text;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "plan_rank" integer;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "suggested_time" text;--> statement-breakpoint
ALTER TABLE "task_plans" ADD CONSTRAINT "task_plans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_plans_ws_idx" ON "task_plans" USING btree ("workspace_id","created_at");