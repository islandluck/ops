CREATE TABLE "executive_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "executive_messages" ADD COLUMN "thread_id" uuid;--> statement-breakpoint
ALTER TABLE "executive_threads" ADD CONSTRAINT "executive_threads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "executive_threads_ws_idx" ON "executive_threads" USING btree ("workspace_id","updated_at");--> statement-breakpoint
CREATE INDEX "executive_messages_thread_idx" ON "executive_messages" USING btree ("workspace_id","thread_id","created_at");