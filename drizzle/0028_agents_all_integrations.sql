-- Backfill: give every active agent access to all connectable integrations.
-- Agent allowlists were seeded narrowly (before HubSpot/Calendar were wired),
-- which left agents looking "not connected" to the newer tools. Execution now
-- keys off what's connected + the task's intent, so a broad allowlist is safe.
UPDATE "agents"
SET "allowed_integrations" = ARRAY['Gmail','Google Calendar','Google Sheets','HubSpot','Notion','Stripe','X (Twitter)']
WHERE "archived" = false;
