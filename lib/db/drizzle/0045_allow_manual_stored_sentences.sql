ALTER TABLE "stored_sentences"
  ALTER COLUMN "article_id" DROP NOT NULL;

ALTER TABLE "stored_sentences"
  ADD COLUMN IF NOT EXISTS "source_text" text;