CREATE TABLE "board_directives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "board_sessions" ADD COLUMN "founder_input" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "board_sessions" ADD COLUMN "project_id" uuid;--> statement-breakpoint
ALTER TABLE "board_directives" ADD CONSTRAINT "board_directives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_directives" ADD CONSTRAINT "board_directives_session_id_board_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."board_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_directives_ws_idx" ON "board_directives" USING btree ("workspace_id","status");