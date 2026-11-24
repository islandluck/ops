CREATE TABLE "networking_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"who" text DEFAULT '' NOT NULL,
	"context" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'planning' NOT NULL,
	"plan" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "networking_targets" ADD CONSTRAINT "networking_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "networking_targets_ws_idx" ON "networking_targets" USING btree ("workspace_id","status");