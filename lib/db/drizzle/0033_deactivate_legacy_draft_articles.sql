-- Validate that every non-deleted legacy DRAFT article has exactly one thought
-- mapped to it (matching author, content reconstruction, sourceArticleId, and
-- deletedAt) before soft-deactivating all DRAFT articles.
-- The block will RAISE and roll back if any validation mismatch is found.
DO $$
DECLARE
  mismatch_count integer;
BEGIN
  -- Count non-deleted DRAFT articles that have no matching thought with:
  --   migrated_from_article_id = article.id
  --   author_id               = article.author_id
  --   deleted_at IS NULL
  SELECT COUNT(*)
  INTO mismatch_count
  FROM articles a
  WHERE a.status = 'DRAFT'
    AND a.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1
      FROM thoughts t
      WHERE t.migrated_from_article_id = a.id
        AND t.author_id = a.author_id
        AND t.deleted_at IS NULL
    );

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0033 validation failed: % non-deleted DRAFT article(s) have no matching thought record. Aborting soft-deactivation.',
      mismatch_count;
  END IF;

  -- Verify the actual migration payload, not only the relation. The original
  -- import deliberately reconstructed one Markdown H1 and carried the source
  -- and soft-delete timestamps across unchanged.
  SELECT COUNT(*)
  INTO mismatch_count
  FROM articles a
  JOIN thoughts t ON t.migrated_from_article_id = a.id
  WHERE a.status = 'DRAFT'
    AND a.deleted_at IS NULL
    AND (
      t.content IS DISTINCT FROM ('# ' || a.title || E'\n\n' || a.content)
      OR t.source_article_id IS DISTINCT FROM a.source_article_id
      OR t.created_at IS DISTINCT FROM a.created_at
      OR t.updated_at IS DISTINCT FROM a.updated_at
      OR t.deleted_at IS DISTINCT FROM a.deleted_at
      OR t.created_from IS DISTINCT FROM
        CASE WHEN a.source_article_id IS NOT NULL THEN 'reading'::thought_created_from
             ELSE 'direct'::thought_created_from END
    );

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0033 validation failed: % DRAFT article(s) have a mismatched thought payload. Aborting soft-deactivation.',
      mismatch_count;
  END IF;

  -- Also check for duplicates: more than one non-deleted thought per DRAFT article
  SELECT COUNT(*)
  INTO mismatch_count
  FROM articles a
  WHERE a.status = 'DRAFT'
    AND a.deleted_at IS NULL
    AND (
      SELECT COUNT(*)
      FROM thoughts t
      WHERE t.migrated_from_article_id = a.id
        AND t.deleted_at IS NULL
    ) > 1;

  IF mismatch_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0033 validation failed: % DRAFT article(s) have more than one active thought mapping. Aborting soft-deactivation.',
      mismatch_count;
  END IF;
END
$$;
--> statement-breakpoint

-- Database-level protection for any future inserts that omit status. Runtime
-- creation always sets DIVIDING explicitly, but the default must not revive
-- the legacy writing stage through an out-of-band insert.
ALTER TABLE "articles"
  ALTER COLUMN "status" SET DEFAULT 'DIVIDING';
--> statement-breakpoint

-- Soft-deactivate all remaining non-deleted DRAFT articles.
-- Their content lives in thoughts (migrated_from_article_id).
UPDATE articles
SET deleted_at = NOW()
WHERE status = 'DRAFT'
  AND deleted_at IS NULL;
