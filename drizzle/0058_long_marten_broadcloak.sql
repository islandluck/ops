CREATE TABLE "executive_saved_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid,
	"role" text DEFAULT 'assistant' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executive_saved_messages" ADD CONSTRAINT "executive_saved_messages_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executive_saved_ws_idx" ON "executive_saved_messages" USING btree ("workspace_id","created_at");