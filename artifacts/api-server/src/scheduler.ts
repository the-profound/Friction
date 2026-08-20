/**
 * Scheduler: space inactivity alerts + letter-arrived push notifications +
 * space-letter reservation processing.
 *
 * Space inactivity:
 *   Polls once per hour for RECRUITING spaces whose planned_starts_at has
 *   already passed and dispatches notifications at 1 / 3 / 7 / 14 day marks.
 *
 * Letter-arrived push:
 *   Runs daily at 06:00 KST.  For users who received ≥1 new letter in the
 *   past 24 hours (visible_at within window), sends a silent Expo push.
 *   A random message from 5 templates is chosen per user.
 *
 * Reservation processing:
 *   Polls every 5 minutes for PENDING `space_scheduled_sends` rows whose
 *   `scheduledAt` has passed, and transitions them to SENT/FAILED. Because
 *   the sweep re-scans the whole table (not just "since last run"), a missed
 *   poll (process restart/downtime) is caught up automatically on the next
 *   run — no reservation is permanently skipped.
 *
 * Deduplication: each (spaceId, dayMilestone) pair is tracked in an
 * in-memory Set so that repeated hourly polls never dispatch the same
 * alert more than once per server process lifetime.
 */
import { db, spacesTable, spaceParticipationsTable } from "@workspace/db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { logger } from "./lib/logger";
import { dispatchNotification } from "./lib/notifications";
import { getNewLetterRecipients } from "./lib/letterNotificationQuery";
import { buildLetterArrivedMessage, SEND_HOUR_KST, WINDOW_HOURS } from "./lib/notificationMessages";
import { sendSilentPush } from "./lib/pushSender";
import { processDueScheduledSends } from "./lib/scheduledSendProcessor";
import { synchronizeSpaceRoundStatuses } from "./lib/spaceRoundStatus";

// ─── Space inactivity ────────────────────────────────────────────────────────

const OPERATOR_ALERT_DAYS = [1, 3, 7];
const PARTICIPANT_ALERT_DAY = 14;
const POLL_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// Tracks (spaceId:days) milestones already dispatched in this process.
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

// ─── Letter-arrived push notification ────────────────────────────────────────

/**
 * Computes the milliseconds until the next 06:00 KST.
 * KST = UTC+9.
 */
function msUntilNextKst6am(): number {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const nowUtcMs = Date.now();
  const nowKstMs = nowUtcMs + KST_OFFSET_MS;

  const nowKstDate = new Date(nowKstMs);
  // Midnight KST today (in KST wall time)
  const midnightKstMs =
    nowKstMs -
    ((nowKstDate.getUTCHours() * 60 + nowKstDate.getUTCMinutes()) * 60 +
      nowKstDate.getUTCSeconds()) *
      1000 -
    nowKstDate.getUTCMilliseconds();

  const next6amKstMs = midnightKstMs + SEND_HOUR_KST * 60 * 60 * 1000;

  const diff = next6amKstMs - nowKstMs;
  // If 06:00 already passed today, schedule for tomorrow
  return diff > 0 ? diff : diff + 24 * 60 * 60 * 1000;
}

async function sendLetterArrivedNotifications(): Promise<void> {
  logger.info("scheduler: running letter-arrived push job");
  try {
    const recipients = await getNewLetterRecipients(WINDOW_HOURS);
    logger.info({ recipientCount: recipients.length }, "scheduler: letter-arrived recipients found");

    for (const recipient of recipients) {
      if (recipient.pushTokens.length === 0) {
        logger.info(
          { userId: recipient.userId },
          "scheduler: no push tokens — skipping user",
        );
        continue;
      }

      const [messageIdx, message] = buildLetterArrivedMessage({
        userName: recipient.nickname,
        letterCount: recipient.newLetterCount,
      });

      const targets = recipient.pushTokens.map((t) => ({
        userId: recipient.userId,
        token: t.token,
        platform: t.platform,
      }));

      const results = await sendSilentPush(targets, message, {
        type: "LETTER_ARRIVED",
        newLetterCount: recipient.newLetterCount,
        target: "inbox",
      });

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;

      logger.info(
        {
          userId: recipient.userId,
          newLetterCount: recipient.newLetterCount,
          messageIdx,
          successCount,
          failCount,
        },
        "scheduler: letter-arrived push dispatched",
      );
    }
  } catch (err) {
    logger.error({ err }, "scheduler: sendLetterArrivedNotifications failed");
  }
}

// ─── Space-letter reservation processing ─────────────────────────────────────

const SCHEDULED_SEND_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

async function runScheduledSendSweep() {
  try {
    await Promise.all([
      processDueScheduledSends(),
      synchronizeSpaceRoundStatuses(),
    ]);
  } catch (err) {
    logger.error({ err }, "scheduler: processDueScheduledSends failed");
  }
}

// ─── Startup ──────────────────────────────────────────────────────────────────

export function startScheduler() {
  // Space inactivity: run once shortly after startup, then every hour
  setTimeout(() => {
    checkInactiveSpaces();
    setInterval(checkInactiveSpaces, POLL_INTERVAL_MS);
  }, 5000);

  // Reservation processing: run once shortly after startup (catches up any
  // reservations that came due while the process was down), then every 5min.
  setTimeout(() => {
    runScheduledSendSweep();
    setInterval(runScheduledSendSweep, SCHEDULED_SEND_POLL_INTERVAL_MS);
  }, 8000);

  // Letter-arrived push: schedule for the next 06:00 KST, then every 24h
  const msToFirst = msUntilNextKst6am();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  logger.info(
    { msToFirst, nextRunInMinutes: Math.round(msToFirst / 60_000) },
    "scheduler: letter-arrived push scheduled",
  );

  setTimeout(() => {
    sendLetterArrivedNotifications();
    setInterval(sendLetterArrivedNotifications, TWENTY_FOUR_HOURS);
  }, msToFirst);
}
