-- Task #2192 (round 3, addressing completion-review findings):
--
-- 1. Fence confirm/release against the specific claim attempt, not just a
--    count, so a presumed-dead attempt that actually finishes late can
--    never resolve a newer attempt's claim: add "lease_id", regenerated on
--    every (re)claim.
-- 2. Replace the mutable-row-COUNT-based claimed_count/notified_count with
--    a cursor over inbox.sequence, a new append-only global ordering
--    column on "inbox" itself that is unaffected by later deletion of any
--    inbox row (a live COUNT can under-report once an already-notified
--    letter is deleted).
--
-- letter_arrival_notifications rows ARE meaningful history (they are the
-- durable record that a recipient was already pushed for a slot), so this
-- migration backfills claimed_through_sequence / notified_through_sequence
-- from the old claimed_count / notified_count instead of truncating the
-- table. For each (recipient_id, delivery_slot) row, that recipient's
-- matching inbox rows are ranked by "sequence" ascending; the backfilled
-- cursor is the highest sequence among the first N ranked rows, where N is
-- the corresponding old count. Ranking by current rows (rather than
-- requiring exactly N rows to still exist) means the backfill is robust to
-- any inbox row having already been deleted by the time this migration
-- runs.
ALTER TABLE "inbox" ADD COLUMN IF NOT EXISTS "sequence" bigserial;

ALTER TABLE "letter_arrival_notifications" ADD COLUMN IF NOT EXISTS "claimed_through_sequence" bigint;
ALTER TABLE "letter_arrival_notifications" ADD COLUMN IF NOT EXISTS "notified_through_sequence" bigint;
ALTER TABLE "letter_arrival_notifications" ADD COLUMN IF NOT EXISTS "lease_id" uuid;

WITH ranked_inbox AS (
  SELECT
    recipient_id,
    visible_at,
    sequence,
    ROW_NUMBER() OVER (PARTITION BY recipient_id, visible_at ORDER BY sequence) AS rn
  FROM "inbox"
)
UPDATE "letter_arrival_notifications" lan
SET
  notified_through_sequence = COALESCE(
    (SELECT MAX(ri.sequence) FROM ranked_inbox ri
       WHERE ri.recipient_id = lan.recipient_id
         AND ri.visible_at = lan.delivery_slot
         AND ri.rn <= lan.notified_count),
    0
  ),
  claimed_through_sequence = COALESCE(
    (SELECT MAX(ri.sequence) FROM ranked_inbox ri
       WHERE ri.recipient_id = lan.recipient_id
         AND ri.visible_at = lan.delivery_slot
         AND ri.rn <= lan.claimed_count),
    -- claimed_count should always have at least one matching inbox row,
    -- but fall back to whatever currently remains, then 0, so this can
    -- never leave the column NULL.
    (SELECT MAX(ri.sequence) FROM ranked_inbox ri
       WHERE ri.recipient_id = lan.recipient_id
         AND ri.visible_at = lan.delivery_slot),
    0
  );

ALTER TABLE "letter_arrival_notifications" DROP COLUMN IF EXISTS "claimed_count";
ALTER TABLE "letter_arrival_notifications" DROP COLUMN IF EXISTS "notified_count";

ALTER TABLE "letter_arrival_notifications" ALTER COLUMN "claimed_through_sequence" SET NOT NULL;
ALTER TABLE "letter_arrival_notifications" ALTER COLUMN "claimed_through_sequence" SET DEFAULT 0;
ALTER TABLE "letter_arrival_notifications" ALTER COLUMN "notified_through_sequence" SET NOT NULL;
ALTER TABLE "letter_arrival_notifications" ALTER COLUMN "notified_through_sequence" SET DEFAULT 0;
