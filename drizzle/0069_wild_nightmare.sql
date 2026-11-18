ALTER TABLE "tasks" ADD COLUMN "source_meeting_id" uuid;--> statement-breakpoint
CREATE INDEX "tasks_ws_meeting_idx" ON "tasks" USING btree ("workspace_id","source_meeting_id");