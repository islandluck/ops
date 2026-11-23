CREATE TABLE "sourcing_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"query" text NOT NULL,
	"status" text DEFAULT 'searching' NOT NULL,
	"result" jsonb,
	"error" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sourcing_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"site" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sourcing_requests" ADD CONSTRAINT "sourcing_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourcing_sources" ADD CONSTRAINT "sourcing_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sourcing_requests_ws_created_idx" ON "sourcing_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "sourcing_sources_ws_idx" ON "sourcing_sources" USING btree ("workspace_id");