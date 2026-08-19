CREATE TABLE "board_contributions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid,
	"member_name" text DEFAULT '' NOT NULL,
	"member_role" text DEFAULT 'custom' NOT NULL,
	"member_emoji" text DEFAULT '' NOT NULL,
	"round" text DEFAULT 'opening' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"seq" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"role" text DEFAULT 'custom' NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"mandate" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '🧑‍⚖️' NOT NULL,
	"accent" text DEFAULT 'slate' NOT NULL,
	"seat" integer DEFAULT 0 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"trigger" text DEFAULT 'user' NOT NULL,
	"status" text DEFAULT 'opening_pending' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"verdict" text DEFAULT '' NOT NULL,
	"disagreements" jsonb,
	"recommendations" jsonb,
	"accountability" text DEFAULT '' NOT NULL,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "board_contributions" ADD CONSTRAINT "board_contributions_session_id_board_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."board_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_contributions" ADD CONSTRAINT "board_contributions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_members" ADD CONSTRAINT "board_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_sessions" ADD CONSTRAINT "board_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_contributions_session_idx" ON "board_contributions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "board_members_ws_idx" ON "board_members" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "board_sessions_ws_idx" ON "board_sessions" USING btree ("workspace_id","created_at");