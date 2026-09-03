-- A CENTER reservation is bound to the round/date/author that was assigned
-- when it was made.  Do not make these live foreign keys: deleting or editing
-- a slot must not rewrite the historical reservation identity.
ALTER TABLE "space_scheduled_sends"
  ADD COLUMN IF NOT EXISTS "reserved_round_id" uuid,
  ADD COLUMN IF NOT EXISTS "reserved_date" date,
  ADD COLUMN IF NOT EXISTS "reservation_author_id" uuid;

-- Backfill only rows for which the existing slot proves the complete binding:
-- the slot is in the letter's round, belongs to the letter author, has a date,
-- and the stored instant is 06:00 on that same KST calendar date.  Everything
-- else remains explicitly unresolved for operational review.
WITH provable AS (
  SELECT ss.id, srs.space_round_id, srs.scheduled_date, sl.author_id
  FROM space_scheduled_sends ss
  JOIN space_letters sl
    ON sl.id = ss.space_letter_id
   AND sl.space_id = ss.space_id
   AND sl.letter_type = 'CENTER'
  JOIN space_round_slots srs
    ON srs.id = ss.slot_id
   AND srs.space_round_id = sl.space_round_id
   AND srs.assigned_user_id = sl.author_id
  WHERE srs.scheduled_date IS NOT NULL
    AND (ss.scheduled_at AT TIME ZONE 'Asia/Seoul')::date = srs.scheduled_date
    AND (ss.scheduled_at AT TIME ZONE 'Asia/Seoul')::time = TIME '06:00:00'
)
UPDATE space_scheduled_sends ss
SET reserved_round_id = p.space_round_id,
    reserved_date = p.scheduled_date,
    reservation_author_id = p.author_id
FROM provable p
WHERE ss.id = p.id
  AND ss.reserved_round_id IS NULL
  AND ss.reserved_date IS NULL
  AND ss.reservation_author_id IS NULL;

DO $$
DECLARE unresolved_count integer;
BEGIN
  SELECT count(*) INTO unresolved_count
  FROM space_scheduled_sends ss
  JOIN space_letters sl ON sl.id = ss.space_letter_id AND sl.space_id = ss.space_id
  WHERE sl.letter_type = 'CENTER'
    AND (ss.reserved_round_id IS NULL OR ss.reserved_date IS NULL OR ss.reservation_author_id IS NULL);
  IF unresolved_count > 0 THEN
    RAISE NOTICE 'left % CENTER scheduled-send reservation(s) unresolved; no binding was guessed', unresolved_count;
  END IF;
END $$;

-- Do not fail a deploy (or delete history) because old data contains a
-- duplicate.  New writes also take an advisory transaction lock; once old
-- duplicates are resolved this partial index adds a permanent DB invariant.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM space_scheduled_sends
    WHERE status = 'PENDING'
      AND reserved_round_id IS NOT NULL
      AND reservation_author_id IS NOT NULL
    GROUP BY reserved_round_id, reservation_author_id
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS "space_scheduled_sends_pending_center_reservation_unique"
      ON "space_scheduled_sends" ("reserved_round_id", "reservation_author_id")
      WHERE "status" = 'PENDING'
        AND "reserved_round_id" IS NOT NULL
        AND "reservation_author_id" IS NOT NULL;
  ELSE
    RAISE NOTICE 'pending CENTER duplicates exist; unique index was not created and rows require review';
  END IF;
END $$;