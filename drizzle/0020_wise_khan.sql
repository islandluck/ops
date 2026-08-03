ALTER TABLE "company_goals" ADD COLUMN "horizon" text DEFAULT 'ongoing' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_goals" ADD COLUMN "metric_key" text;--> statement-breakpoint
ALTER TABLE "company_goals" ADD COLUMN "target_number" integer;