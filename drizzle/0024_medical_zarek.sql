CREATE TABLE "company_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"deep_dive_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"pack" jsonb DEFAULT '{"people":[],"timeline":[],"themes":[],"decisions":[],"open_threads":[],"risks":[],"products":[]}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deep_dive_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deep_dive_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text DEFAULT 'upload' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"raw_text" text,
	"char_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"distilled" jsonb,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deep_dives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"stage_detail" text DEFAULT '' NOT NULL,
	"progress" jsonb DEFAULT '{"done":0,"total":0}'::jsonb NOT NULL,
	"usage" jsonb DEFAULT '{"input_tokens":0,"output_tokens":0,"est_cost_cents":0,"calls":0}'::jsonb NOT NULL,
	"error" text,
	"worker_locked_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "company_context" ADD CONSTRAINT "company_context_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_context" ADD CONSTRAINT "company_context_deep_dive_id_deep_dives_id_fk" FOREIGN KEY ("deep_dive_id") REFERENCES "public"."deep_dives"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_dive_sources" ADD CONSTRAINT "deep_dive_sources_deep_dive_id_deep_dives_id_fk" FOREIGN KEY ("deep_dive_id") REFERENCES "public"."deep_dives"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_dive_sources" ADD CONSTRAINT "deep_dive_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deep_dives" ADD CONSTRAINT "deep_dives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;