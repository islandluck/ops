CREATE TABLE "team_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"ref_type" text,
	"ref_id" uuid,
	"title" text DEFAULT '' NOT NULL,
	"handoff_note" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'assigned' NOT NULL,
	"deadline" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"role_title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"skills" text[] DEFAULT '{}' NOT NULL,
	"birthday" text DEFAULT '' NOT NULL,
	"start_date" text DEFAULT '' NOT NULL,
	"timezone" text DEFAULT '' NOT NULL,
	"emoji" text DEFAULT '' NOT NULL,
	"accent" text DEFAULT 'indigo' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_assignments" ADD CONSTRAINT "team_assignments_member_id_team_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."team_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_assignments_ws_idx" ON "team_assignments" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "team_assignments_member_idx" ON "team_assignments" USING btree ("member_id");--> statement-breakpoint
CREATE INDEX "team_members_ws_idx" ON "team_members" USING btree ("workspace_id");