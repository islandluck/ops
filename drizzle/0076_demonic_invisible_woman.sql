CREATE TABLE "outreach_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"target_roles" text DEFAULT '' NOT NULL,
	"target_count" integer DEFAULT 5 NOT NULL,
	"status" text DEFAULT 'sourcing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"website" text,
	"person_name" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"contact_email" text,
	"contact_method" text DEFAULT 'none' NOT NULL,
	"contact_url" text,
	"source" text DEFAULT 'research' NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"outbound_draft_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach_contacts" ADD CONSTRAINT "outreach_contacts_campaign_id_outreach_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outreach_campaigns_ws_idx" ON "outreach_campaigns" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "outreach_contacts_ws_campaign_idx" ON "outreach_contacts" USING btree ("workspace_id","campaign_id");