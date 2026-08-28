CREATE TABLE "chat_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"last_read_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"detail" text DEFAULT '' NOT NULL,
	"kind" text DEFAULT 'meeting' NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recurrence" text DEFAULT '' NOT NULL,
	"member_id" uuid,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_meetings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"meeting_date" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"attendee_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_by_member_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_goals" ADD COLUMN "member_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "chat_reads" ADD CONSTRAINT "chat_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_events" ADD CONSTRAINT "team_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_meetings" ADD CONSTRAINT "team_meetings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_reads_idx" ON "chat_reads" USING btree ("workspace_id","user_id","channel_id");--> statement-breakpoint
CREATE INDEX "team_events_ws_idx" ON "team_events" USING btree ("workspace_id","starts_at");--> statement-breakpoint
CREATE INDEX "team_meetings_ws_idx" ON "team_meetings" USING btree ("workspace_id","meeting_date");