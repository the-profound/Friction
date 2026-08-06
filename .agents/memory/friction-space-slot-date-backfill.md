---
name: Space slot scheduledDate backfill
description: How the one-time backfill for space_round_slots.scheduledDate was derived and verified, for future backfills of the same kind.
---

The space-start route's `calculateOccasionDate` (in `artifacts/api-server/src/routes/spaces.ts`) is exported and reused directly by one-time backfill scripts instead of being reimplemented — it is the single source of truth for occasion-date math (N_DAY interval vs WEEKDAY pattern) and must stay exported for that reason.

A backfill script must reconstruct the *same* global occasion cursor the live route uses: walk rounds in `roundNumber` order, slots in `slotOrder` order within each round, and advance the cursor by a round's total slot count after processing it — even slots that already have a date — or later rounds' computed dates drift from what the live route would have produced.

**Why:** the cursor is genuinely global across a space's whole lifetime (not reset per round), so any short-cut that only counts NULL slots or skips already-dated slots silently desyncs from the round-start route's math.

**How to apply:** verify a backfill of this kind by spot-checking actual rows against schedule config (interval days / weekday pattern) after running, and by running the script twice to confirm the second run is a no-op.
