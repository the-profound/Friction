ALTER TABLE "inbox"
  ADD COLUMN IF NOT EXISTS "source_space_id" uuid
  REFERENCES "spaces"("id") ON DELETE SET NULL;

ALTER TABLE "inbox"
  ADD COLUMN IF NOT EXISTS "source_space_scheduled_send_id" uuid
  REFERENCES "space_scheduled_sends"("id") ON DELETE SET NULL;

-- Normalize only legacy rows that can be tied to exactly one SENT space
-- reservation and are not owned by the existing person-send audit path.
-- Team rows remain protected by their non-null source_team_collection_id.
WITH legacy_matches AS (
  SELECT
    i.id AS inbox_id,
    MIN(ss.space_id::text)::uuid AS space_id,
    MIN(ss.id::text)::uuid AS scheduled_send_id,
    COUNT(*) AS match_count
  FROM "inbox" i
  JOIN "space_letters" sl
    ON sl.source_article_id = i.article_id
   AND sl.author_id = i.sender_id
  JOIN "space_scheduled_sends" ss
    ON ss.space_letter_id = sl.id
   AND ss.space_id = sl.space_id
   AND ss.status = 'SENT'
   AND i.visible_at = ss.scheduled_at
  WHERE i.source_team_collection_id IS NULL
    AND i.source_space_id IS NULL
    AND i.source_space_scheduled_send_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "send_records" sr WHERE sr.inbox_id = i.id
    )
  GROUP BY i.id
)
UPDATE "inbox" i
SET
  source_space_id = m.space_id,
  source_space_scheduled_send_id = m.scheduled_send_id
FROM legacy_matches m
WHERE i.id = m.inbox_id
  AND m.match_count = 1;

-- Keep person/team uniqueness while adding the space reservation as an
-- independent source dimension.
ALTER TABLE "inbox"
  DROP CONSTRAINT IF EXISTS "inbox_recipient_article_source_unique";

ALTER TABLE "inbox"
  ADD CONSTRAINT "inbox_recipient_article_sources_unique"
  UNIQUE NULLS NOT DISTINCT (
    "recipient_id",
    "article_id",
    "source_team_collection_id",
    "source_space_scheduled_send_id"
  );

-- A space reservation is the durable idempotency key. One reservation may
-- create one row per recipient, and retries/concurrent workers cannot create
-- a second row for the same recipient.
CREATE UNIQUE INDEX IF NOT EXISTS "inbox_space_scheduled_send_recipient_unique"
  ON "inbox" ("recipient_id", "source_space_scheduled_send_id")
  WHERE "source_space_scheduled_send_id" IS NOT NULL;