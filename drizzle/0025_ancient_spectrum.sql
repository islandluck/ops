CREATE TABLE "opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"scanner_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"org" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"deadline" text DEFAULT '' NOT NULL,
	"amount" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"fit_score" integer DEFAULT 0 NOT NULL,
	"fit_rationale" text DEFAULT '' NOT NULL,
	"requirements" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"project_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "opportunity_scanners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"cadence" text DEFAULT 'weekly' NOT NULL,
	"mode" text DEFAULT 'scan' NOT NULL,
	"scope" text DEFAULT 'state' NOT NULL,
	"sources" text[] DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_error" text,
	"usage" jsonb DEFAULT '{"input_tokens":0,"output_tokens":0,"searches":0,"est_cost_cents":0,"runs":0}'::jsonb NOT NULL,
	"worker_locked_at" timestamp with time zone,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "city" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "state" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "business_briefs" ADD COLUMN "country" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_scanner_id_opportunity_scanners_id_fk" FOREIGN KEY ("scanner_id") REFERENCES "public"."opportunity_scanners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scanners" ADD CONSTRAINT "opportunity_scanners_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "opportunities_ws_url_uniq" ON "opportunities" USING btree ("workspace_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "opportunity_scanners_ws_type_uniq" ON "opportunity_scanners" USING btree ("workspace_id","type");