DROP INDEX IF EXISTS "space_scheduled_sends_pending_center_reservation_unique";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "space_scheduled_sends"
    WHERE "status" = 'PENDING'
      AND "slot_id" IS NOT NULL
      AND "reserved_round_id" IS NOT NULL
      AND "reservation_author_id" IS NOT NULL
      AND "reserved_date" IS NOT NULL
    GROUP BY "slot_id", "reserved_round_id", "reservation_author_id", "reserved_date"
    HAVING count(*) > 1
  ) THEN
    CREATE UNIQUE INDEX "space_scheduled_sends_pending_center_reservation_unique"
      ON "space_scheduled_sends" (
        "slot_id",
        "reserved_round_id",
        "reservation_author_id",
        "reserved_date"
      )
      WHERE "status" = 'PENDING'
        AND "slot_id" IS NOT NULL
        AND "reserved_round_id" IS NOT NULL
        AND "reservation_author_id" IS NOT NULL
        AND "reserved_date" IS NOT NULL;
  ELSE
    RAISE NOTICE 'exact-slot pending CENTER duplicates exist; unique index was not created and rows require review';
  END IF;
END $$;