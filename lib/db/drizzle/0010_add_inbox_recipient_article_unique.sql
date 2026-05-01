-- Remove duplicate inbox rows, keeping the one that is read (isRead=true) or, if
-- none is read, the earliest row by created_at.
DELETE FROM inbox
WHERE id IN (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY recipient_id, article_id
        ORDER BY is_read DESC, created_at ASC
      ) AS rn
    FROM inbox
  ) ranked
  WHERE rn > 1
);

-- Add unique constraint to prevent future duplicates.
ALTER TABLE "inbox"
  ADD CONSTRAINT "inbox_recipient_article_unique" UNIQUE ("recipient_id", "article_id");
