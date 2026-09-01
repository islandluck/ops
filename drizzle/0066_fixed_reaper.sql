DROP INDEX "command_center_ws_uniq";--> statement-breakpoint
ALTER TABLE "command_center" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "email_triage" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "integrations" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "outbound_drafts" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "member_user_id" uuid;--> statement-breakpoint
ALTER TABLE "team_members" ADD COLUMN "page_access" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "command_center_ws_member_uniq" ON "command_center" USING btree ("workspace_id","member_user_id") WHERE "command_center"."member_user_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "command_center_ws_uniq" ON "command_center" USING btree ("workspace_id") WHERE "command_center"."member_user_id" IS NULL;