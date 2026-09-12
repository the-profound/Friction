-- Splits "claimed" from "successfully notified" in the letter-arrived push
-- ledger (Task #2192), fixing two residual gaps in the Task #2110 design:
--
--   1. The old single `letter_count` column was written the moment a
--      recipient was claimed, before the caller attempted `sendPush`. If the
--      push actually failed to send, the recipient was already permanently
--      marked as handled and could never be retried.
--   2. A recipient could only ever be claimed once per slot, so a second
--      wave of inbox rows landing in the same exact slot (e.g. two
--      overlapping space-letter delivery batches) was silently absorbed —
--      no follow-up push, no updated count.
--
-- `claimed_count` now tracks the inbox total reserved by the current (or
-- most recently resolved) attempt; `notified_count` tracks the inbox total
-- actually confirmed pushed. `claimed_count == notified_count` means no
-- attempt is in flight for this recipient/slot — the next caller can safely
-- claim any newly-arrived letters (or retry a previously failed attempt,
-- since retrying rolls `claimed_count` back down to `notified_count`).
-- `claimed_count != notified_count` means an attempt is currently in
-- flight and must not be claimed again until it confirms or releases.
ALTER TABLE "letter_arrival_notifications"
  RENAME COLUMN "letter_count" TO "claimed_count";

ALTER TABLE "letter_arrival_notifications"
  ADD COLUMN "notified_count" integer NOT NULL DEFAULT 0;

-- Every pre-existing row was written under the old "claim implies notified"
-- semantics, so backfill notified_count to match — none of them should be
-- treated as having a push newly outstanding.
UPDATE "letter_arrival_notifications"
  SET "notified_count" = "claimed_count";
