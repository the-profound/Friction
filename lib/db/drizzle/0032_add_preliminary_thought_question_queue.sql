-- Store generated questions as preliminary thoughts and keep their FIFO order
-- separately for each user. All statements are repeat-safe for existing installs.
ALTER TABLE "thoughts"
  ADD COLUMN IF NOT EXISTS "source_stored_sentence_id" uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thoughts_source_stored_sentence_id_stored_sentences_id_fk'
  ) THEN
    ALTER TABLE "thoughts"
      ADD CONSTRAINT "thoughts_source_stored_sentence_id_stored_sentences_id_fk"
      FOREIGN KEY ("source_stored_sentence_id") REFERENCES "stored_sentences"("id");
  END IF;
END
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "thought_question_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "question_thought_id" uuid NOT NULL,
  "source_thought_id" uuid,
  "source_stored_sentence_id" uuid,
  "source_article_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "thought_question_sources_one_source_check"
    CHECK (num_nonnulls("source_thought_id", "source_stored_sentence_id", "source_article_id") = 1)
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_sources_question_thought_id_thoughts_id_fk') THEN
    ALTER TABLE "thought_question_sources"
      ADD CONSTRAINT "thought_question_sources_question_thought_id_thoughts_id_fk"
      FOREIGN KEY ("question_thought_id") REFERENCES "thoughts"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_sources_source_thought_id_thoughts_id_fk') THEN
    ALTER TABLE "thought_question_sources"
      ADD CONSTRAINT "thought_question_sources_source_thought_id_thoughts_id_fk"
      FOREIGN KEY ("source_thought_id") REFERENCES "thoughts"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_sources_source_stored_sentence_id_stored_sentences_id_fk') THEN
    ALTER TABLE "thought_question_sources"
      ADD CONSTRAINT "thought_question_sources_source_stored_sentence_id_stored_sentences_id_fk"
      FOREIGN KEY ("source_stored_sentence_id") REFERENCES "stored_sentences"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_sources_source_article_id_articles_id_fk') THEN
    ALTER TABLE "thought_question_sources"
      ADD CONSTRAINT "thought_question_sources_source_article_id_articles_id_fk"
      FOREIGN KEY ("source_article_id") REFERENCES "articles"("id");
  END IF;
END
$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thought_question_sources_unique_idx"
  ON "thought_question_sources" (
    "question_thought_id",
    "source_thought_id",
    "source_stored_sentence_id",
    "source_article_id"
  );
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "thought_question_queue" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "thought_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_queue_user_id_users_id_fk') THEN
    ALTER TABLE "thought_question_queue"
      ADD CONSTRAINT "thought_question_queue_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "users"("id");
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'thought_question_queue_thought_id_thoughts_id_fk') THEN
    ALTER TABLE "thought_question_queue"
      ADD CONSTRAINT "thought_question_queue_thought_id_thoughts_id_fk"
      FOREIGN KEY ("thought_id") REFERENCES "thoughts"("id");
  END IF;
END
$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thought_question_queue_user_thought_unique_idx"
  ON "thought_question_queue" ("user_id", "thought_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "thought_question_queue_user_position_unique_idx"
  ON "thought_question_queue" ("user_id", "position");
--> statement-breakpoint

-- These counters belonged exclusively to the removed home-screen widget.
ALTER TABLE "thoughts"
  DROP COLUMN IF EXISTS "recommended_at_widget",
  DROP COLUMN IF EXISTS "recommended_times_widget";