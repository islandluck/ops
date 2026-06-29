ALTER TABLE "agents" ADD COLUMN "instructions" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "folder" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "background_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "allowed_integrations" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "log_activity" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "tier" text DEFAULT 'worker' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "premium" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "created_by_type" text DEFAULT 'system' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "emoji" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "accent" text DEFAULT 'indigo' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "archived" boolean DEFAULT false NOT NULL;