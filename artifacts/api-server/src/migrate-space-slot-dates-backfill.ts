/**
 * One-time migration: backfill `scheduledDate` on space_round_slots for
 * spaces that were started before #1378 introduced slot date calculation.
 *
 * #1378 made space start (RECRUITING -> ACTIVE) compute each new slot's
 * `scheduledDate` from the space's schedule config (scheduleType/weekdays/
 * defaultCenterInterval) using `calculateOccasionDate`, keyed off a global
 * occasion cursor that advances slot-by-slot across all of a space's rounds.
 * Spaces that were already ACTIVE/ARCHIVED before that fix still have slots
 * with a NULL `scheduledDate`, which makes the reservation list and space
 * detail screens disagree about whether a member is currently assigned.
 *
 * This script re-runs the exact same calculation for every already-started
 * space (startedAt + scheduleType present), walking rounds in round_number
 * order and slots in slot_order order to reconstruct the same global
 * occasion cursor #1378 uses at creation time, and fills in only the slots
 * whose scheduledDate is still NULL. Slots that already have a date
 * (whether computed previously or manually edited by an operator) are left
 * untouched, so the script is idempotent and safe to re-run.
 *
 * Run:
 *   pnpm --filter @workspace/api-server migrate:space-slot-dates-backfill
 */

import { asc, eq, isNotNull } from "drizzle-orm";
import { db, pool, spacesTable, spaceRoundsTable, spaceRoundSlotsTable } from "@workspace/db";
import { kstDateString } from "./lib/deliverySlot";
import { calculateOccasionDate } from "./routes/spaces";

async function main() {
  // -------------------------------------------------------------------------
  // 0. Guard: check there are already-started spaces with a schedule config.
  // -------------------------------------------------------------------------
  const startedSpaces = await db
    .select({
      id: spacesTable.id,
      startedAt: spacesTable.startedAt,
      scheduleType: spacesTable.scheduleType,
      weekdays: spacesTable.weekdays,
      defaultCenterInterval: spacesTable.defaultCenterInterval,
    })
    .from(spacesTable)
    .where(isNotNull(spacesTable.startedAt))
    .orderBy(asc(spacesTable.id));

  const eligibleSpaces = startedSpaces.filter((s) => s.scheduleType != null);

  if (eligibleSpaces.length === 0) {
    console.log("[slot-dates-backfill] No started spaces with a schedule config found — nothing to do.");
    return;
  }
  console.log(`[slot-dates-backfill] Found ${eligibleSpaces.length} started space(s) to inspect.`);

  // -------------------------------------------------------------------------
  // Before counts, for the log summary.
  // -------------------------------------------------------------------------
  const { rows: beforeRows } = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM space_round_slots srs
    JOIN space_rounds sr ON sr.id = srs.space_round_id
    JOIN spaces s ON s.id = sr.space_id
    WHERE s.started_at IS NOT NULL
      AND s.schedule_type IS NOT NULL
      AND srs.scheduled_date IS NULL
  `);
  const nullSlotsBefore = parseInt(beforeRows[0].count, 10);
  console.log(`[slot-dates-backfill] Slots with NULL scheduledDate (eligible spaces) before: ${nullSlotsBefore}`);

  let spacesTouched = 0;
  let slotsFilled = 0;
  let slotsSkippedUnresolvable = 0;

  await db.transaction(async (tx) => {
    for (const space of eligibleSpaces) {
      const scheduleType = space.scheduleType as "N_DAY" | "WEEKDAY";
      const weekdays = space.weekdays ?? [];
      const intervalDays = space.defaultCenterInterval;
      const startedAt = space.startedAt as Date;

      const rounds = await tx
        .select({ id: spaceRoundsTable.id, roundNumber: spaceRoundsTable.roundNumber })
        .from(spaceRoundsTable)
        .where(eq(spaceRoundsTable.spaceId, space.id))
        .orderBy(asc(spaceRoundsTable.roundNumber));

      let occasionCursor = 0;
      let spaceHadUpdate = false;

      for (const round of rounds) {
        const slots = await tx
          .select({
            id: spaceRoundSlotsTable.id,
            slotOrder: spaceRoundSlotsTable.slotOrder,
            scheduledDate: spaceRoundSlotsTable.scheduledDate,
          })
          .from(spaceRoundSlotsTable)
          .where(eq(spaceRoundSlotsTable.spaceRoundId, round.id))
          .orderBy(asc(spaceRoundSlotsTable.slotOrder));

        for (const slot of slots) {
          if (slot.scheduledDate == null) {
            const occasionDate = calculateOccasionDate(
              startedAt,
              scheduleType,
              intervalDays,
              weekdays,
              occasionCursor + slot.slotOrder,
            );
            if (occasionDate) {
              await tx
                .update(spaceRoundSlotsTable)
                .set({ scheduledDate: kstDateString(occasionDate) })
                .where(eq(spaceRoundSlotsTable.id, slot.id));
              slotsFilled++;
              spaceHadUpdate = true;
            } else {
              // scheduleType === "WEEKDAY" with no weekdays configured — the
              // schedule config is incomplete, so there's nothing to derive.
              slotsSkippedUnresolvable++;
            }
          }
        }

        // Advance the global occasion cursor by this round's slot count,
        // mirroring the `occasionCursor += slots.length` step in the space
        // start route so later rounds' positions stay in sync even when
        // some of this round's slots were already dated.
        occasionCursor += slots.length;
      }

      if (spaceHadUpdate) spacesTouched++;
    }
  });

  // -------------------------------------------------------------------------
  // Verification
  // -------------------------------------------------------------------------
  const { rows: afterRows } = await pool.query<{ count: string }>(`
    SELECT COUNT(*)::text AS count
    FROM space_round_slots srs
    JOIN space_rounds sr ON sr.id = srs.space_round_id
    JOIN spaces s ON s.id = sr.space_id
    WHERE s.started_at IS NOT NULL
      AND s.schedule_type IS NOT NULL
      AND srs.scheduled_date IS NULL
  `);
  const nullSlotsAfter = parseInt(afterRows[0].count, 10);

  console.log("\n[slot-dates-backfill] ✓ Backfill complete.");
  console.log(`  Spaces touched: ${spacesTouched}`);
  console.log(`  Slots filled: ${slotsFilled}`);
  console.log(`  Slots skipped (incomplete schedule config, e.g. WEEKDAY with no weekdays): ${slotsSkippedUnresolvable}`);
  console.log(`  Slots with NULL scheduledDate (eligible spaces) before -> after: ${nullSlotsBefore} -> ${nullSlotsAfter}`);
  if (nullSlotsAfter !== slotsSkippedUnresolvable) {
    console.warn(
      `[slot-dates-backfill] ⚠ Remaining NULL slot count (${nullSlotsAfter}) does not match the ` +
      `unresolvable count from this run (${slotsSkippedUnresolvable}) — investigate before re-running.`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[slot-dates-backfill] Migration failed:", err);
    process.exit(1);
  });
