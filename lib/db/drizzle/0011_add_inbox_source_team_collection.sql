-- Add source_team_collection_id to inbox so the same article delivered via
-- multiple team collections produces one inbox row per (recipient, article,
-- source_team_collection_id). 1:1/neighbor sends keep NULL.
ALTER TABLE "inbox"
  ADD COLUMN IF NOT EXISTS "source_team_collection_id" uuid
  REFERENCES "team_collections"("id") ON DELETE SET NULL;

-- Best-effort backfill: for legacy inbox rows (NULL source_team_collection_id),
-- pick the earliest team_collection_articles row whose article matches and
-- whose addedBy equals the inbox sender (i.e. the team collection through
-- which the article was originally fanned out to this recipient). This keeps
-- the new "출처 모임명" working for previously delivered items where possible.
UPDATE "inbox" i
SET "source_team_collection_id" = sub.team_collection_id
FROM (
  SELECT DISTINCT ON (i2.id) i2.id AS inbox_id, tca.team_collection_id
  FROM "inbox" i2
  JOIN "team_collection_articles" tca
    ON tca.article_id = i2.article_id
   AND tca.added_by = i2.sender_id
  JOIN "team_collection_memberships" tcm
    ON tcm.team_collection_id = tca.team_collection_id
   AND tcm.user_id = i2.recipient_id
  WHERE i2.source_team_collection_id IS NULL
  ORDER BY i2.id, tca.added_at ASC
) sub
WHERE i.id = sub.inbox_id;

-- Replace the old (recipient, article) unique constraint with a 3-column
-- unique that treats NULLs as equal so the 1:1/neighbor dedupe behavior is
-- preserved (NULLS NOT DISTINCT, Postgres 15+).
ALTER TABLE "inbox"
  DROP CONSTRAINT IF EXISTS "inbox_recipient_article_unique";

ALTER TABLE "inbox"
  ADD CONSTRAINT "inbox_recipient_article_source_unique"
  UNIQUE NULLS NOT DISTINCT ("recipient_id", "article_id", "source_team_collection_id");
