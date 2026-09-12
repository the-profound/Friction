/**
 * Scheduler: space inactivity alerts + letter-arrived push notifications +
 * space-letter reservation processing.
 *
 * Space inactivity:
 *   Polls once per hour for RECRUITING spaces whose planned_starts_at has
 *   already passed and dispatches notifications at 1 / 3 / 7 / 14 day marks.
 *
 * Letter-arrived push:
 *   Every recipient of a letter delivered at a given 06:00 KST slot gets a
 *   push for that slot exactly once. Three things can trigger a recheck of a
 *   given slot: the daily 06:00 KST timer, the reservation-processing sweep
 *   below right after it commits inbox rows for that slot, and the sweep's
 *   own periodic retry recheck (see below). The sweep+timer pairing closes
 *   the race where a slot's space-letter deliveries are still being
 *   committed (5-minute poll, not synced to 06:00) at the moment the
 *   independent 06:00 timer fires: the push job no longer trusts "now" to
 *   mean "the sweep is done" — it is re-triggered by the sweep itself once
 *   the relevant rows actually land. `notifyLetterArrivalsForSlot` aggregates
 *   strictly by exact `visibleAt = slot` match (every inbox insert path pins
 *   visibleAt to a canonical 06:00 KST instant — see ./lib/deliverySlot.ts)
 *   and atomically claims each recipient in `letter_arrival_notifications`
 *   before pushing, so calling it more than once for the same slot — from
 *   the timer, from the sweep, or both — can never double-notify.
 *
 *   A push that genuinely fails to send releases its claim instead of
 *   confirming it (see ../lib/letterNotificationQuery.ts), which makes that
 *   recipient/slot re-claimable — but does not, by itself, guarantee any
 *   future call actually happens for that exact slot again once neither the
 *   06:00 timer nor new reservation activity ever revisits it. The sweep
 *   below closes that gap too: every 5-minute tick, in addition to rechecking
 *   slots with newly-committed reservation rows, it also asks
 *   `findDeliverySlotsNeedingLetterPushRetry` for every slot with a released
 *   or stale-locked (crashed mid-attempt) row and rechecks those as well —
 *   so a failed push, or one whose process died mid-send, is always retried
 *   within one sweep interval, never stranded indefinitely.
 *
 * Reservation processing:
 *   Polls every 5 minutes for PENDING `space_scheduled_sends` rows whose
 *   `scheduledAt` has passed, and transitions them to SENT/FAILED. Because
 *   the sweep re-scans the whole table (not just "since last run"), a missed
 *   poll (process restart/downtime) is caught up automatically on the next
 *   run — no reservation is permanently skipped. Each run reports which
 *   delivery slots it committed rows for, and the scheduler immediately
 *   rechecks the letter-arrived push job for each of them. The sweep is also
 *   fired once exactly at the next 06:00 KST (same timer as the
 *   letter-arrived push below), in addition to the 5-minute interval — so a
 *   reservation due right at 06:00 lands in the recipient's inbox at that
 *   moment instead of waiting up to ~5 minutes for the next periodic poll.
 *   Running the sweep from both triggers at nearly the same time is safe:
 *   `processOneScheduledSend` locks each reservation row (`FOR UPDATE`)
 *   inside its transaction and only transitions PENDING -> SENT once, so a
 *   trigger that loses the race always sees the already-committed state and
 *   performs idempotent repair instead of a duplicate send.
 *
 * Deduplication: each (spaceId, dayMilestone) pair is tracked in an
 * in-memory Set so that repeated hourly polls never dispatch the same
 * alert more than once per server process lifetime.
 */
import { db, spacesTable, spaceParticipationsTable } from "@workspace/db";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { logger } from "./lib/logger";
import { dispatchNotification } from "./lib/notifications";
import {
  claimNewLetterRecipientsForSlot,
  confirmLetterNotificationSent,
  findDeliverySlotsNeedingLetterPushRetry,
  releaseLetterNotificationClaim,
} from "./lib/letterNotificationQuery";
import { buildLetterArrivedMessage, SEND_HOUR_KST } from "./lib/notificationMessages";
import { normalizeToKst6 } from "./lib/deliverySlot";
import { sendPush } from "./lib/pushSender";
import { processDueScheduledSends } from "./lib/scheduledSendProcessor";
import { synchronizeSpaceRoundStatuses } from "./lib/spaceRoundStatus";
import {
  createCorrelationId,
  logOperationalMetric,
} from "./lib/operationalTelemetry";

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
  const correlationId = createCorrelationId();
  const startedAt = performance.now();
  let dispatchedCount = 0;
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
          }, { correlationId });
          dispatchedCount += 1;
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
          }, { correlationId });
          dispatchedCount += 1;

          dispatchNotification({
            type: "SPACE_OPERATOR_ACTION_REQUIRED_14DAY",
            spaceId: space.id,
            operatorId: space.creatorId,
            daysOverdue: days,
            options: ["ARCHIVE", "EXTEND_PLANNED_STARTS_AT"],
          }, { correlationId });
          dispatchedCount += 1;
        }
      }
    }
    logOperationalMetric(logger, {
      operation: "scheduler.inactive-space",
      outcome: "success",
      durationMs: performance.now() - startedAt,
      correlationId,
      count: recruitingSpaces.length,
      successCount: dispatchedCount,
    });
  } catch (err) {
    logger.error({ err, correlationId }, "scheduler: checkInactiveSpaces failed");
    logOperationalMetric(logger, {
      operation: "scheduler.inactive-space",
      outcome: "failure",
      durationMs: performance.now() - startedAt,
      correlationId,
      failureType: "job_failed",
      failureCount: 1,
    });
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

export async function notifyLetterArrivalsForSlot(deliverySlot: Date): Promise<void> {
  const correlationId = createCorrelationId();
  const startedAt = performance.now();
  let successCount = 0;
  let failureCount = 0;
  logger.info(
    { correlationId, deliverySlot: deliverySlot.toISOString() },
    "scheduler: running letter-arrived push job",
  );
  try {
    const recipients = await claimNewLetterRecipientsForSlot(deliverySlot);
    logger.info(
      { correlationId, recipientCount: recipients.length, deliverySlot: deliverySlot.toISOString() },
      "scheduler: letter-arrived recipients claimed",
    );

    for (const recipient of recipients) {
      if (recipient.pushTokens.length === 0) {
        logger.info(
          { correlationId, tokenCount: 0 },
          "scheduler: no push tokens — skipping user",
        );
        // Nothing to push, so there is nothing to retry either — confirm
        // immediately so this recipient's claim doesn't linger unresolved
        // and block a later trigger from claiming genuinely new letters.
        await confirmLetterNotificationSent(
          recipient.userId,
          deliverySlot,
          recipient.leaseId,
          recipient.claimedThroughSequence,
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

      const results = await sendPush(targets, message, {
        type: "LETTER_ARRIVED",
        newLetterCount: recipient.newLetterCount,
        target: "inbox",
      }, { correlationId });

      const recipientSuccessCount = results.filter((r) => r.success).length;
      const failCount = results.length - recipientSuccessCount;
      successCount += recipientSuccessCount;
      failureCount += failCount;

      if (recipientSuccessCount > 0) {
        // At least one device was actually notified — confirm so this
        // recipient is never re-pushed for these same letters.
        await confirmLetterNotificationSent(
          recipient.userId,
          deliverySlot,
          recipient.leaseId,
          recipient.claimedThroughSequence,
        );
      } else {
        // The push genuinely failed to send (provider outage, transient
        // network error, chunk_send_failed, ...) rather than merely
        // finding zero recipients — release the claim so a later trigger
        // for this same slot retries exactly these letters instead of
        // permanently losing them.
        await releaseLetterNotificationClaim(
          recipient.userId,
          deliverySlot,
          recipient.leaseId,
        );
      }

      logger.info(
        {
          correlationId,
          newLetterCount: recipient.newLetterCount,
          messageIdx,
          successCount: recipientSuccessCount,
          failCount,
        },
        "scheduler: letter-arrived push dispatched",
      );
    }
    logOperationalMetric(logger, {
      operation: "scheduler.letter-push",
      outcome: failureCount > 0 ? (successCount > 0 ? "degraded" : "failure") : "success",
      durationMs: performance.now() - startedAt,
      correlationId,
      failureType: failureCount > 0 ? "push_delivery_failed" : undefined,
      successCount,
      failureCount,
    });
  } catch (err) {
    logger.error({ err, correlationId }, "scheduler: notifyLetterArrivalsForSlot failed");
    logOperationalMetric(logger, {
      operation: "scheduler.letter-push",
      outcome: "failure",
      durationMs: performance.now() - startedAt,
      correlationId,
      failureType: "job_failed",
      successCount,
      failureCount: failureCount + 1,
    });
  }
}

// ─── Space-letter reservation processing ─────────────────────────────────────

const SCHEDULED_SEND_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export async function runScheduledSendSweep() {
  const correlationId = createCorrelationId();

  // Round-status sync failing must never block reservation delivery (or the
  // notification recheck it triggers), and vice versa — these are
  // independent failure domains, so allSettled rather than Promise.all.
  const [scheduledSendResult] = await Promise.allSettled([
    processDueScheduledSends({ correlationId }),
    (async () => {
      const startedAt = performance.now();
      try {
        await synchronizeSpaceRoundStatuses();
        logOperationalMetric(logger, {
          operation: "scheduler.round-status",
          outcome: "success",
          durationMs: performance.now() - startedAt,
          correlationId,
        });
      } catch (error) {
        logger.error({ err: error, correlationId }, "scheduler: round status sync failed");
        logOperationalMetric(logger, {
          operation: "scheduler.round-status",
          outcome: "failure",
          durationMs: performance.now() - startedAt,
          correlationId,
          failureType: "job_failed",
        });
        throw error;
      }
    })(),
  ]);

  if (scheduledSendResult.status === "rejected") {
    logger.error(
      { err: scheduledSendResult.reason, correlationId },
      "scheduler: processDueScheduledSends failed",
    );
    // Deliberately does NOT return here: the periodic retry-discovery
    // recheck below is the only guaranteed future trigger for a
    // released/stale-locked claim, and it must not depend on reservation
    // processing succeeding on the same tick — they are independent
    // failure domains (see the allSettled above), and a persistent
    // reservation-processing outage must never be able to strand a
    // released letter-push claim indefinitely.
  }

  // Re-check the letter-arrived push job for every slot that just had inbox
  // rows committed, right after this transaction is durable — closing the
  // race between the 5-minute delivery poll and the independent 06:00
  // timer. Each slot gets its own try/catch so one slot's failure never
  // blocks notifying the others.
  const slotsToRecheck = new Map<number, Date>();
  if (scheduledSendResult.status === "fulfilled") {
    for (const slot of scheduledSendResult.value.affectedSlots) {
      slotsToRecheck.set(slot.getTime(), slot);
    }
  }

  // Also recheck every slot with a released or stale-locked (crashed
  // mid-attempt) claim, regardless of whether any new reservation activity
  // happened for it, and regardless of whether processDueScheduledSends
  // itself just failed above — this is what actually retries a
  // genuinely-failed push in production instead of leaving it merely
  // "eligible" for a retry that no future trigger would otherwise cause.
  // Runs every 5 minutes, so a release or a stale lock is never stranded
  // for more than one interval.
  try {
    const retrySlots = await findDeliverySlotsNeedingLetterPushRetry();
    for (const slot of retrySlots) {
      slotsToRecheck.set(slot.getTime(), slot);
    }
  } catch (err) {
    logger.error(
      { err, correlationId },
      "scheduler: findDeliverySlotsNeedingLetterPushRetry failed",
    );
  }

  for (const slot of slotsToRecheck.values()) {
    try {
      await notifyLetterArrivalsForSlot(slot);
    } catch (err) {
      logger.error(
        { err, correlationId, deliverySlot: slot.toISOString() },
        "scheduler: post-sweep notification recheck failed for slot",
      );
    }
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

  // Exact-06:00 delivery sweep + letter-arrived push: schedule for the next
  // 06:00 KST, then every 24h. Two things fire at this exact moment:
  //   1. The scheduled-send sweep itself (the same function driven by the
  //      5-minute interval above) — so a reservation due exactly at 06:00
  //      KST is committed to the recipient's inbox right away instead of
  //      waiting up to ~5 minutes for the next periodic poll. See the
  //      "Reservation processing" note atop this file for why running it
  //      from both triggers close together is safe.
  //   2. The letter-arrived push recheck for the current slot — one of two
  //      triggers for a given slot (the sweep's own post-commit recheck is
  //      the other, and typically fires first since it runs synchronously
  //      right after this same sweep call) — claimNewLetterRecipientsForSlot's
  //      atomic per-recipient-per-slot claim means whichever trigger runs
  //      first for a slot does the notifying, and the other is a safe no-op.
  const msToFirst = msUntilNextKst6am();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  logger.info(
    { msToFirst, nextRunInMinutes: Math.round(msToFirst / 60_000) },
    "scheduler: exact-06:00 delivery sweep + letter-arrived push scheduled",
  );

  const runForCurrentSlot = () => notifyLetterArrivalsForSlot(normalizeToKst6(new Date()));

  const runExact6amTriggers = () => {
    runScheduledSendSweep();
    runForCurrentSlot();
  };

  setTimeout(() => {
    runExact6amTriggers();
    setInterval(runExact6amTriggers, TWENTY_FOUR_HOURS);
  }, msToFirst);
}
