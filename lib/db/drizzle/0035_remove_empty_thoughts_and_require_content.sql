-- A thought must contain visible text or a real Markdown image. Clean up
-- legacy placeholder shells before making that rule mandatory.
WITH empty_thoughts AS (
  SELECT id
  FROM thoughts
  WHERE content IS NULL
     OR (
       length(regexp_replace(regexp_replace(content, '!\[[^]]*\]\([^)]*\)?', '', 'g'), '[[:space:]#*_~`>|[\](){},.!+\-=]', '', 'g')) = 0
       AND content !~ '!\[[^]]*\]\([[:space:]]*[^)[:space:]][^)]*\)'
     )
),
deleted_queue AS (
  DELETE FROM thought_question_queue
  WHERE thought_id IN (SELECT id FROM empty_thoughts)
),
deleted_sources AS (
  DELETE FROM thought_question_sources
  WHERE question_thought_id IN (SELECT id FROM empty_thoughts)
     OR source_thought_id IN (SELECT id FROM empty_thoughts)
),
deleted_promotions AS (
  DELETE FROM thought_promotions
  WHERE from_thought_id IN (SELECT id FROM empty_thoughts)
)
DELETE FROM thoughts
WHERE id IN (SELECT id FROM empty_thoughts);
--> statement-breakpoint

ALTER TABLE thoughts
  ALTER COLUMN content SET NOT NULL;
--> statement-breakpoint

ALTER TABLE thoughts
  DROP CONSTRAINT IF EXISTS thoughts_content_meaningful_check;
--> statement-breakpoint

ALTER TABLE thoughts
  ADD CONSTRAINT thoughts_content_meaningful_check
  CHECK (
    length(regexp_replace(regexp_replace(content, '!\[[^]]*\]\([^)]*\)?', '', 'g'), '[[:space:]#*_~`>|[\](){},.!+\-=]', '', 'g')) > 0
    OR content ~ '!\[[^]]*\]\([[:space:]]*[^)[:space:]][^)]*\)'
  );