/**
 * Space operator inactivity notification scheduler.
 *
 * Polls once per hour for RECRUITING spaces whose planned_starts_at has
 * already passed and dispatches notifications at 1 / 3 / 7 / 14 day marks.
 *
 * Deduplication: each (spaceId, dayMilestone) pair is tracked in an
 * in-memory Set so that repeated hourly polls never dispatch the same
 * alert more than once per server process lifetime.  A future version
 * should persist sent milestones to the DB for durability across restarts.
 *
 * Actual push delivery is wired up via the notification infrastructure.
 * Until that integration is available the events are logged so they can
 * be picked up by a future adapter.
 */
import { db, spacesTable, spaceParticipationsTable } from "@workspace/db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { logger } from "./lib/logger";
import { dispatchNotification } from "./lib/notifications";

const OPERATOR_ALERT_DAYS = [1, 3, 7];
const PARTICIPANT_ALERT_DAY = 14;
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Tracks (spaceId:days) milestones already dispatched in this process.
// Prevents duplicate notifications across hourly poll cycles.
const dispatchedMilestones = new Set<string>();

function milestoneKey(spaceId: string, days: number): string {
  return `${spaceId}:${days}`;
}

function daysSince(date: Date): number {
  const ms = Date.now() - date.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

async function checkInactiveSpaces() {
  try {
    const now = new Date();
    const recruitingSpaces = await db
      .select()
      .from(spacesTable)
      .where(
        and(
          eq(spacesTable.status, "RECRUITING"),
          isNotNull(spacesTable.plannedStartsAt),
          lt(spacesTable.plannedStartsAt, now),
        ),
      );

    for (const space of recruitingSpaces) {
      if (!space.plannedStartsAt) continue;
      const days = daysSince(new Date(space.plannedStartsAt));

      if (OPERATOR_ALERT_DAYS.includes(days)) {
        const key = milestoneKey(space.id, days);
        if (!dispatchedMilestones.has(key)) {
          dispatchedMilestones.add(key);
          dispatchNotification({
            type: "SPACE_OPERATOR_NOT_STARTED_ALERT",
            spaceId: space.id,
            operatorId: space.creatorId,
            daysOverdue: days,
          });
        }
      }

      if (days === PARTICIPANT_ALERT_DAY) {
        const key = milestoneKey(space.id, days);
        if (!dispatchedMilestones.has(key)) {
          dispatchedMilestones.add(key);

          // Fetch approved non-operator participants
          const participants = await db
            .select({ userId: spaceParticipationsTable.userId, role: spaceParticipationsTable.role })
            .from(spaceParticipationsTable)
            .where(
              and(
                eq(spaceParticipationsTable.spaceId, space.id),
                eq(spaceParticipationsTable.status, "APPROVED"),
              ),
            );

          const participantIds = participants
            .filter((p) => p.role !== "OPERATOR")
            .map((p) => p.userId);

          dispatchNotification({
            type: "SPACE_PARTICIPANT_NOT_STARTED_14DAY",
            spaceId: space.id,
            participantIds,
            daysOverdue: days,
          });

          dispatchNotification({
            type: "SPACE_OPERATOR_ACTION_REQUIRED_14DAY",
            spaceId: space.id,
            operatorId: space.creatorId,
            daysOverdue: days,
            options: ["ARCHIVE", "EXTEND_PLANNED_STARTS_AT"],
          });
        }
      }
    }
  } catch (err) {
    logger.error({ err }, "scheduler: checkInactiveSpaces failed");
  }
}

export function startScheduler() {
  // Run once shortly after startup, then on the hourly interval
  setTimeout(() => {
    checkInactiveSpaces();
    setInterval(checkInactiveSpaces, POLL_INTERVAL_MS);
  }, 5000);
}
