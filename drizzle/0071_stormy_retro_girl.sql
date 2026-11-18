ALTER TABLE "job_posts" ADD COLUMN "pay_type" text DEFAULT 'unspecified' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "pay_min" integer;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "pay_max" integer;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "pay_currency" text DEFAULT 'usd' NOT NULL;--> statement-breakpoint
ALTER TABLE "job_posts" ADD COLUMN "compliance_md" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "compliance_md" text;