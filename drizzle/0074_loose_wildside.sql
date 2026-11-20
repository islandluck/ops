CREATE TABLE "quote_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"spec" text DEFAULT '' NOT NULL,
	"target_count" integer DEFAULT 3 NOT NULL,
	"status" text DEFAULT 'sourcing' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"website" text,
	"contact_email" text,
	"source" text DEFAULT 'research' NOT NULL,
	"status" text DEFAULT 'found' NOT NULL,
	"outbound_draft_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"quote_price" text DEFAULT '' NOT NULL,
	"quote_lead_time" text DEFAULT '' NOT NULL,
	"quote_notes" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_suppliers" ADD CONSTRAINT "quote_suppliers_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quote_suppliers" ADD CONSTRAINT "quote_suppliers_request_id_quote_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."quote_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "quote_requests_ws_idx" ON "quote_requests" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "quote_suppliers_ws_request_idx" ON "quote_suppliers" USING btree ("workspace_id","request_id");