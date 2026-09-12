-- Task #2192 follow-up: add a locked_at marker so a released (failed-push)
-- or crashed (stale-locked) claim stays discoverable by
-- findDeliverySlotsNeedingLetterPushRetry instead of merely being
-- re-claimable without any guaranteed future trigger.
ALTER TABLE "letter_arrival_notifications" ADD COLUMN IF NOT EXISTS "locked_at" timestamp with time zone;
