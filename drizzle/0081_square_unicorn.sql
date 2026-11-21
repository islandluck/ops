CREATE TABLE "fundraise_investors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"round_id" uuid NOT NULL,
	"company_id" uuid,
	"contact_id" uuid,
	"name" text DEFAULT '' NOT NULL,
	"stage" text DEFAULT 'researching' NOT NULL,
	"check_amount_cents" integer,
	"is_lead" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fundraise_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"target_amount_cents" integer,
	"valuation_cents" integer,
	"status" text DEFAULT 'open' NOT NULL,
	"close_date" timestamp with time zone,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fundraise_investors" ADD CONSTRAINT "fundraise_investors_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_investors" ADD CONSTRAINT "fundraise_investors_round_id_fundraise_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."fundraise_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_investors" ADD CONSTRAINT "fundraise_investors_company_id_crm_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."crm_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_investors" ADD CONSTRAINT "fundraise_investors_contact_id_crm_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."crm_contacts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fundraise_rounds" ADD CONSTRAINT "fundraise_rounds_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fundraise_investors_ws_round_idx" ON "fundraise_investors" USING btree ("workspace_id","round_id");--> statement-breakpoint
CREATE INDEX "fundraise_investors_ws_stage_idx" ON "fundraise_investors" USING btree ("workspace_id","stage");--> statement-breakpoint
CREATE INDEX "fundraise_rounds_ws_idx" ON "fundraise_rounds" USING btree ("workspace_id","created_at");