CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"author_name" text DEFAULT '' NOT NULL,
	"task_id" uuid,
	"task_title" text DEFAULT '' NOT NULL,
	"name" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"folder" text DEFAULT '' NOT NULL,
	"doc_type" text DEFAULT 'document' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;