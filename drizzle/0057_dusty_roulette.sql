CREATE TABLE "team_notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"kind" text DEFAULT 'info' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_events" ADD COLUMN "attendee_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_events" ADD COLUMN "all_team" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "team_notifications" ADD CONSTRAINT "team_notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_notifications_member_idx" ON "team_notifications" USING btree ("workspace_id","member_id","created_at");