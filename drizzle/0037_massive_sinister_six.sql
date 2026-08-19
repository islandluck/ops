CREATE TABLE "board_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid,
	"member_name" text DEFAULT '' NOT NULL,
	"member_role" text DEFAULT 'custom' NOT NULL,
	"member_emoji" text DEFAULT '' NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"suggested_action" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "board_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"cadence" text DEFAULT 'daily' NOT NULL,
	"last_scan_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "board_alerts" ADD CONSTRAINT "board_alerts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "board_settings" ADD CONSTRAINT "board_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "board_alerts_ws_idx" ON "board_alerts" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "board_settings_ws_uniq" ON "board_settings" USING btree ("workspace_id");