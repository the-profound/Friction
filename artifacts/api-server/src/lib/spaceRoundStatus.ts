import { eq } from "drizzle-orm";
import { db, spaceRoundsTable } from "@workspace/db";
import { kstDateString } from "./deliverySlot";

export type SpaceRoundStatus = "UPCOMING" | "ACTIVE" | "COMPLETED";

type RoundPeriod = {
  startsAt: Date | null;
  endsAt: Date | null;
  status: SpaceRoundStatus;
};

/**
 * Resolves the display/storage status for a dated round using KST calendar
 * dates. A round remains active through its end date, inclusive.
 *
 * Rounds without a start date retain their stored status because they do not
 * yet have a reliable period to derive from.
 */
export function getSpaceRoundStatusForPeriod(
  round: RoundPeriod,
  now: Date = new Date(),
): SpaceRoundStatus {
  if (!round.startsAt) return round.status;

  const today = kstDateString(now);
  const startsOn = kstDateString(round.startsAt);
  if (today < startsOn) return "UPCOMING";

  if (round.endsAt && today > kstDateString(round.endsAt)) {
    return "COMPLETED";
  }

  return "ACTIVE";
}

/**
 * Catches persisted round statuses up to their KST date periods. This is used
 * both when rounds are read and by the background scheduler so a delayed
 * scheduler run can never leave the UI with a stale status.
 */
export async function synchronizeSpaceRoundStatuses(
  now: Date = new Date(),
  spaceId?: string,
): Promise<void> {
  const baseQuery = db
    .select({
      id: spaceRoundsTable.id,
      startsAt: spaceRoundsTable.startsAt,
      endsAt: spaceRoundsTable.endsAt,
      status: spaceRoundsTable.status,
    })
    .from(spaceRoundsTable);
  const rounds = spaceId
    ? await baseQuery.where(eq(spaceRoundsTable.spaceId, spaceId))
    : await baseQuery;

  await Promise.all(
    rounds.map(async (round) => {
      const nextStatus = getSpaceRoundStatusForPeriod(round, now);
      if (nextStatus === round.status) return;
      await db
        .update(spaceRoundsTable)
        .set({ status: nextStatus })
        .where(eq(spaceRoundsTable.id, round.id));
    }),
  );
}