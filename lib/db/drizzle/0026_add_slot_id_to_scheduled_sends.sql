ALTER TABLE "space_scheduled_sends"
  ADD COLUMN IF NOT EXISTS "slot_id" uuid REFERENCES "space_round_slots"("id") ON DELETE SET NULL;
