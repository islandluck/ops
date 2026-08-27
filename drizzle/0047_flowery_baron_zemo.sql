ALTER TABLE "team_members" ADD COLUMN "team_role" text DEFAULT 'contributor' NOT NULL;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "manager_id" uuid;