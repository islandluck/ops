CREATE TABLE "email_settings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"member_user_id" uuid NOT NULL,
	"signature" text DEFAULT '' NOT NULL,
	"reply_style" text DEFAULT '' NOT NULL,
	"cadence" text DEFAULT 'off' NOT NULL,
	"last_run_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "email_settings" ADD CONSTRAINT "email_settings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_settings_ws_member_uniq" ON "email_settings" USING btree ("workspace_id","member_user_id");