CREATE TABLE "fundraise_intro_paths" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"investor_id" uuid NOT NULL,
	"portfolio_company" text DEFAULT '' NOT NULL,
	"portfolio_domain" text,
	"founder_name" text DEFAULT '' NOT NULL,
	"founder_title" text DEFAULT '' NOT NULL,
	"founder_email" text,
	"relevance" text DEFAULT '' NOT NULL,
	"relevance_score" integer,
	"status" text DEFAULT 'suggested' NOT NULL,
	"outreach_contact_id" uuid,
	"crm_contact_id" uuid,
	"source" text DEFAULT 'ai' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fundraise_intro_paths" ADD CONSTRAINT "fundraise_intro_paths_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_intro_paths" ADD CONSTRAINT "fundraise_intro_paths_investor_id_fundraise_investors_id_fk" FOREIGN KEY ("investor_id") REFERENCES "public"."fundraise_investors"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_intro_paths" ADD CONSTRAINT "fundraise_intro_paths_outreach_contact_id_outreach_contacts_id_fk" FOREIGN KEY ("outreach_contact_id") REFERENCES "public"."outreach_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_intro_paths" ADD CONSTRAINT "fundraise_intro_paths_crm_contact_id_crm_contacts_id_fk" FOREIGN KEY ("crm_contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fundraise_intro_paths_ws_investor_idx" ON "fundraise_intro_paths" USING btree ("workspace_id","investor_id");