ALTER TABLE "applications" ADD COLUMN "ai_recommend" boolean;--> statement-breakpoint
ALTER TABLE "applications" ADD COLUMN "ai_eval" jsonb DEFAULT '{"strengths":[],"concerns":[]}'::jsonb NOT NULL;