CREATE TABLE "reply_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_id" uuid,
	"tweet_id" text NOT NULL,
	"tweet_url" text DEFAULT '' NOT NULL,
	"author_handle" text DEFAULT '' NOT NULL,
	"tweet_text" text DEFAULT '' NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"suggested_replies" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" text DEFAULT 'new' NOT NULL,
	"reply_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "x_targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handle" text NOT NULL,
	"x_user_id" text,
	"note" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_seen_tweet_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reply_opportunities" ADD CONSTRAINT "reply_opportunities_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reply_opportunities" ADD CONSTRAINT "reply_opportunities_target_id_x_targets_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."x_targets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "x_targets" ADD CONSTRAINT "x_targets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reply_opps_ws_tweet_uniq" ON "reply_opportunities" USING btree ("workspace_id","tweet_id");--> statement-breakpoint
CREATE UNIQUE INDEX "x_targets_ws_handle_uniq" ON "x_targets" USING btree ("workspace_id","handle");