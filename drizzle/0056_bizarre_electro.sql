ALTER TABLE "team_events" ADD COLUMN "duration_minutes" integer DEFAULT 60 NOT NULL;--> statement-breakpoint
ALTER TABLE "team_events" ADD COLUMN "recurrence_until" timestamp with time zone;