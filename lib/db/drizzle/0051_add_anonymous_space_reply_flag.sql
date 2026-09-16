-- Task #2286: anonymous-Space-originated personal replies must be
-- permanently treated as recipient-only, matching the privacy guarantee
-- Space-feed replies already have. Recording this durably on send_records
-- itself (rather than re-deriving it later from the source inbox row) is
-- required because inbox rows can be hard-deleted, which would otherwise
-- make the origin unrecoverable.
ALTER TABLE "send_records"
  ADD COLUMN IF NOT EXISTS "is_anonymous_space_reply" boolean NOT NULL DEFAULT false;

-- Backfill existing reply send_records rows while their source inbox rows
-- (and therefore the originating space) can still be resolved. Only rows
-- whose replied-to letter came from a Space with is_anonymous = true are
-- flagged; everything else keeps the false default.
UPDATE "send_records" sr
SET "is_anonymous_space_reply" = true
FROM "inbox" i
JOIN "spaces" s ON s.id = i.source_space_id
WHERE sr.target_type = 'reply'
  AND sr.reply_to_inbox_id = i.id
  AND s.is_anonymous = true
  AND sr.is_anonymous_space_reply = false;
