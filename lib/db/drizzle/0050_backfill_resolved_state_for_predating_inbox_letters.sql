-- Task #2192 remediation: this project's `letter_arrival_notifications`
-- table was mistakenly TRUNCATEd by an earlier draft of migration 0049
-- before that draft was corrected (see 0049's current comment) to backfill
-- from claimed_count/notified_count instead. That TRUNCATE already ran
-- against the live database, so the old claimed_count/notified_count
-- values themselves are gone and 0049's backfill can no longer reconstruct
-- them.
--
-- However, the underlying "inbox" rows were never touched, so the safe
-- remediation is: for every (recipient_id, visible_at) pair that currently
-- has inbox rows, seed a resolved ledger row (claimed_through_sequence ==
-- notified_through_sequence == the current max sequence for that
-- recipient/slot). This is the conservative direction — it means none of
-- these already-delivered letters will ever be treated as "new" and
-- re-pushed, which is exactly the property the sequence-cursor ledger
-- exists to guarantee. The only cost is that a recipient whose push
-- genuinely failed to send before this remediation (indistinguishable now
-- from a successful send, since that state was lost with the truncate)
-- will not receive a make-up push for letters delivered before this
-- migration runs — acceptable given delivery slots are per-day 06:00
-- instants and this only affects already-elapsed slots, not future ones.
INSERT INTO "letter_arrival_notifications"
  (recipient_id, delivery_slot, claimed_through_sequence, notified_through_sequence, lease_id, locked_at, notified_at)
SELECT
  recipient_id,
  visible_at AS delivery_slot,
  MAX(sequence) AS max_sequence,
  MAX(sequence) AS max_sequence,
  NULL,
  NULL,
  now()
FROM "inbox"
GROUP BY recipient_id, visible_at
ON CONFLICT (recipient_id, delivery_slot) DO UPDATE
  SET claimed_through_sequence = GREATEST(
        letter_arrival_notifications.claimed_through_sequence,
        EXCLUDED.claimed_through_sequence
      ),
      notified_through_sequence = GREATEST(
        letter_arrival_notifications.notified_through_sequence,
        EXCLUDED.notified_through_sequence
      )
  WHERE letter_arrival_notifications.locked_at IS NULL;
