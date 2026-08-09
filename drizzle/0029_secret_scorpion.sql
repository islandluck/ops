CREATE TABLE "email_triage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"gmail_message_id" text NOT NULL,
	"thread_id" text DEFAULT '' NOT NULL,
	"source_message_id" text DEFAULT '' NOT NULL,
	"from_name" text DEFAULT '' NOT NULL,
	"from_email" text DEFAULT '' NOT NULL,
	"subject" text DEFAULT '' NOT NULL,
	"snippet" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"urgency" text DEFAULT '' NOT NULL,
	"action_type" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"draft_reply" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'triaged' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "email_signature" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "email_reply_style" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_triage" ADD CONSTRAINT "email_triage_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_triage_ws_msg_uniq" ON "email_triage" USING btree ("workspace_id","gmail_message_id");