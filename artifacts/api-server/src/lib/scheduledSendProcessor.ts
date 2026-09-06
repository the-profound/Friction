/**
 * Atomically delivers due space-letter reservations to recipient inboxes.
 *
 * Each reservation is processed while its row is locked. Inbox creation and
 * the PENDING -> SENT transition share one transaction, and the reservation id
 * is persisted on every inbox row as the durable idempotency key. SENT rows
 * with no delivery rows are also selected so deployments repair historical
 * omissions without duplicating successful deliveries.
 */
import {
  articlesTable,
  db,
  inboxTable,
  letterRecipientAccessTable,
  spacesTable,
  spaceLettersTable,
  spaceParticipationsTable,
  spaceRoundSlotsTable,
  spaceScheduledSendRecipientsTable,
  spaceScheduledSendsTable,
} from "@workspace/db";
import { and, eq, inArray, isNull, lte, or, sql, type SQL } from "drizzle-orm";
import { logger } from "./logger";
import {
  createCorrelationId,
  logOperationalMetric,
  SCHEDULED_SEND_DELAY_ALERT_MS,
} from "./operationalTelemetry";

export interface ProcessDueScheduledSendsResult {
  sentCount: number;
  failedCount: number;
}

const READABLE_ARTICLE_STATUSES = new Set(["DIVIDING", "CLOSING", "LETTER"]);

function isKstSixOClockOn(date: Date, expectedDate: string): boolean {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}` === expectedDate &&
    value("hour") === "06" && value("minute") === "00";
}

export function resolveSpaceDeliveryRecipientIds(input: {
  authorId: string;
  creatorId: string;
  approvedParticipantIds: string[];
}): string[] {
  const recipients = new Set(input.approvedParticipantIds);
  // The creator/operator remains a recipient even in legacy spaces where the
  // operator participation row is absent, and regardless of slot participation.
  recipients.add(input.creatorId);
  recipients.delete(input.authorId);
  return [...recipients];
}

type ProcessOneResult = "sent" | "repaired" | "failed" | "skipped";

function logReservationOutcome(input: {
  correlationId: string;
  scheduledSendId: string;
  outcome: ProcessOneResult;
  delayMs: number;
  failureType?: string;
}) {
  const level =
    input.outcome === "failed"
      ? logger.error.bind(logger)
      : input.delayMs >= SCHEDULED_SEND_DELAY_ALERT_MS
        ? logger.warn.bind(logger)
        : logger.info.bind(logger);
  level(
    {
      event: "operational.scheduled_send_outcome",
      correlationId: input.correlationId,
      scheduledSendId: input.scheduledSendId,
      outcome: input.outcome,
      delayMs: input.delayMs,
      failureType: input.failureType,
    },
    "scheduled send reservation processed",
  );
}
async function processOneScheduledSend(
  sendId: string,
  now: Date,
  correlationId: string,
  observeDelay: (delayMs: number) => void,
): Promise<ProcessOneResult> {
  return db.transaction(async (tx) => {
    // Serialize workers on this reservation. A second worker re-reads the
    // committed state below and can only perform idempotent repair.
    await tx.execute(
      sql`SELECT id FROM space_scheduled_sends WHERE id = ${sendId} FOR UPDATE`,
    );

    const [send] = await tx
      .select()
      .from(spaceScheduledSendsTable)
      .where(eq(spaceScheduledSendsTable.id, sendId))
      .limit(1);

    if (
      !send ||
      send.scheduledAt > now ||
      (send.status !== "PENDING" && send.status !== "SENT")
    ) {
      logReservationOutcome({
        correlationId,
        scheduledSendId: sendId,
        outcome: "skipped",
        delayMs: 0,
      });
      return "skipped";
    }
    const delayMs = Math.max(0, now.getTime() - send.scheduledAt.getTime());
    observeDelay(delayMs);

    const [letter] = await tx
      .select()
      .from(spaceLettersTable)
      .where(
        and(
          eq(spaceLettersTable.id, send.spaceLetterId),
          eq(spaceLettersTable.spaceId, send.spaceId),
        ),
      )
      .limit(1);
    const [space] = await tx
      .select({
        id: spacesTable.id,
        creatorId: spacesTable.creatorId,
        status: spacesTable.status,
      })
      .from(spacesTable)
      .where(eq(spacesTable.id, send.spaceId))
      .limit(1);

    let failureReason: string | null = null;
    if (!letter) {
      failureReason = "원본 공간 글을 찾을 수 없습니다.";
    } else if (!space) {
      failureReason = "공간을 찾을 수 없습니다.";
    } else if (space.status === "ARCHIVED" && send.status === "PENDING") {
      failureReason = "공간이 종료되어 발신할 수 없습니다.";
    } else if (!letter.sourceArticleId) {
      failureReason = "수신함에 전달할 원본 글이 없습니다.";
    } else if (letter.letterType === "CENTER") {
      // A CENTER send must deliver the exact immutable assignment it reserved,
      // not whichever slot happens to be assigned when a delayed worker runs.
      if (
        !send.slotId ||
        !send.reservedRoundId ||
        !send.reservedDate ||
        !send.reservationAuthorId ||
        send.reservationAuthorId !== letter.authorId ||
        send.reservedRoundId !== letter.spaceRoundId ||
        !isKstSixOClockOn(send.scheduledAt, send.reservedDate)
      ) {
        failureReason = "예약 당시의 회차·슬롯·날짜 정보가 완전하지 않거나 일치하지 않습니다.";
      } else {
        const [slot] = await tx
          .select()
          .from(spaceRoundSlotsTable)
          .where(eq(spaceRoundSlotsTable.id, send.slotId))
          .limit(1);
        if (
          !slot ||
          slot.spaceRoundId !== send.reservedRoundId ||
          slot.assignedUserId !== send.reservationAuthorId ||
          slot.scheduledDate !== send.reservedDate
        ) {
          failureReason = "예약 슬롯이 예약 당시의 회차·작성자·날짜와 일치하지 않습니다.";
        }
      }
    }
    if (!failureReason && letter && letter.sourceArticleId) {
      const [article] = await tx
        .select({
          id: articlesTable.id,
          status: articlesTable.status,
          deletedAt: articlesTable.deletedAt,
        })
        .from(articlesTable)
        .where(eq(articlesTable.id, letter.sourceArticleId))
        .limit(1);
      if (!article || article.deletedAt || !READABLE_ARTICLE_STATUSES.has(article.status)) {
        failureReason = "원본 글을 읽을 수 없어 발신할 수 없습니다.";
      }
    }

    if (failureReason) {
      // A SENT row is historical evidence.  Never overwrite it merely because
      // present-day slot data changed; it may only receive safe inbox repair.
      if (send.status === "SENT") return "skipped";
      await tx
        .update(spaceScheduledSendsTable)
        .set({ status: "FAILED", failureReason, sentAt: null })
        .where(
          and(
            eq(spaceScheduledSendsTable.id, send.id),
            inArray(spaceScheduledSendsTable.status, ["PENDING", "SENT"]),
          ),
        );
      logger.warn(
        {
          event: "operational.scheduled_send_failure",
          correlationId,
          scheduledSendId: send.id,
          failureType: "invalid_reservation_state",
        },
        "scheduled send could not be delivered",
      );
      logReservationOutcome({
        correlationId,
        scheduledSendId: send.id,
        outcome: "failed",
        delayMs,
        failureType: "invalid_reservation_state",
      });
      return "failed";
    }

    let recipientSnapshot = await tx
      .select({ recipientId: spaceScheduledSendRecipientsTable.recipientId })
      .from(spaceScheduledSendRecipientsTable)
      .where(eq(spaceScheduledSendRecipientsTable.scheduledSendId, send.id));

    if (!send.recipientsSnapshottedAt) {
      const participationConditions: SQL[] = [
        eq(spaceParticipationsTable.spaceId, send.spaceId),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ];
      if (send.status === "SENT") {
        participationConditions.push(
          lte(
            spaceParticipationsTable.createdAt,
            send.sentAt ?? send.scheduledAt,
          ),
          // Legacy rows have no dedicated approvedAt. updatedAt <= cutoff is
          // conservative evidence that the currently-approved state already
          // existed by delivery time, and prevents late approvals from being
          // added retroactively.
          lte(
            spaceParticipationsTable.updatedAt,
            send.sentAt ?? send.scheduledAt,
          ),
        );
      }
      const participations = await tx
        .select({ userId: spaceParticipationsTable.userId })
        .from(spaceParticipationsTable)
        .where(and(...participationConditions));
      const resolvedRecipientIds = resolveSpaceDeliveryRecipientIds({
        authorId: letter!.authorId,
        creatorId: space!.creatorId,
        approvedParticipantIds: participations.map((row) => row.userId),
      });
      if (resolvedRecipientIds.length > 0) {
        await tx
          .insert(spaceScheduledSendRecipientsTable)
          .values(
            resolvedRecipientIds.map((recipientId) => ({
              scheduledSendId: send.id,
              recipientId,
            })),
          )
          .onConflictDoNothing();
      }
      // Only a PENDING send can create a complete snapshot: it is frozen in
      // this same delivery transaction.  A historical SENT row has no way to
      // prove that currently visible legacy evidence is exhaustive, so retain
      // its unresolved state and merely repair recipients that are provable.
      if (send.status === "PENDING") {
        await tx
          .update(spaceScheduledSendsTable)
          .set({ recipientsSnapshottedAt: now })
          .where(eq(spaceScheduledSendsTable.id, send.id));
      }
      recipientSnapshot = [...new Set([
        ...recipientSnapshot.map((row) => row.recipientId),
        ...resolvedRecipientIds,
      ])].map((recipientId) => ({
        recipientId,
      }));
    }

    const recipientIds = recipientSnapshot.map((row) => row.recipientId);

    if (recipientIds.length > 0) {
      await tx
        .insert(inboxTable)
        .values(
          recipientIds.map((recipientId) => ({
            recipientId,
            articleId: letter!.sourceArticleId!,
            senderId: letter!.authorId,
            sourceSpaceId: send.spaceId,
            sourceSpaceScheduledSendId: send.id,
            visibleAt: send.scheduledAt,
          })),
        )
        .onConflictDoNothing({
          target: [
            inboxTable.recipientId,
            inboxTable.sourceSpaceScheduledSendId,
          ],
          where: sql`${inboxTable.sourceSpaceScheduledSendId} IS NOT NULL`,
        });

      // Accumulate letter_recipient_access rows so visibility filtering reflects
      // all sends for this letter (not just the most recent one).
      await tx
        .insert(letterRecipientAccessTable)
        .values(
          recipientIds.map((userId) => ({
            letterId: send.spaceLetterId,
            userId,
          })),
        )
        .onConflictDoNothing();
    }

    if (send.status === "PENDING") {
      await tx
        .update(spaceScheduledSendsTable)
        .set({ status: "SENT", sentAt: now, failureReason: null })
        .where(
          and(
            eq(spaceScheduledSendsTable.id, send.id),
            eq(spaceScheduledSendsTable.status, "PENDING"),
          ),
        );
      logReservationOutcome({
        correlationId,
        scheduledSendId: send.id,
        outcome: "sent",
        delayMs,
      });
      return "sent";
    }
    logReservationOutcome({
      correlationId,
      scheduledSendId: send.id,
      outcome: "repaired",
      delayMs,
    });
    return "repaired";
  });
}

export async function processDueScheduledSends(opts?: {
  spaceId?: string;
  correlationId?: string;
}): Promise<ProcessDueScheduledSendsResult> {
  const startedAt = performance.now();
  const correlationId = opts?.correlationId ?? createCorrelationId();
  const now = new Date();
  const conditions = [
    lte(spaceScheduledSendsTable.scheduledAt, now),
    or(
      eq(spaceScheduledSendsTable.status, "PENDING"),
      and(
        eq(spaceScheduledSendsTable.status, "SENT"),
        or(
          isNull(spaceScheduledSendsTable.recipientsSnapshottedAt),
          sql`EXISTS (
            SELECT 1
            FROM space_scheduled_send_recipients ssr
            WHERE ssr.scheduled_send_id = ${spaceScheduledSendsTable.id}
              AND NOT EXISTS (
                SELECT 1
                FROM inbox i
                WHERE i.source_space_scheduled_send_id = ${spaceScheduledSendsTable.id}
                  AND i.recipient_id = ssr.recipient_id
              )
          )`,
        )!,
      ),
    )!,
  ];
  if (opts?.spaceId) {
    conditions.push(eq(spaceScheduledSendsTable.spaceId, opts.spaceId));
  }

  const candidates = await db
    .select({ id: spaceScheduledSendsTable.id })
    .from(spaceScheduledSendsTable)
    .where(and(...conditions));

  let sentCount = 0;
  let failedCount = 0;
  let repairedCount = 0;
  let delayedCount = 0;
  let maxDelayMs = 0;

  for (const candidate of candidates) {
    try {
      const result = await processOneScheduledSend(
        candidate.id,
        now,
        correlationId,
        (delayMs) => {
          maxDelayMs = Math.max(maxDelayMs, delayMs);
          if (delayMs >= SCHEDULED_SEND_DELAY_ALERT_MS) delayedCount += 1;
        },
      );
      if (result === "sent") sentCount += 1;
      if (result === "repaired") repairedCount += 1;
      if (result === "failed") failedCount += 1;
    } catch (err) {
      // The transaction rolls back both inbox rows and status changes. Leave a
      // PENDING reservation retryable rather than committing a false SENT.
      failedCount += 1;
      logger.error(
        {
          err,
          event: "operational.scheduled_send_failure",
          correlationId,
          scheduledSendId: candidate.id,
          failureType: "transaction_rollback",
        },
        "scheduledSendProcessor: delivery transaction rolled back",
      );
    }
  }

  if (sentCount > 0 || failedCount > 0 || repairedCount > 0) {
    logger.info(
      {
        correlationId,
        candidateCount: candidates.length,
        sentCount,
        failedCount,
        repairedCount,
        delayedCount,
        maxDelayMs,
      },
      "scheduledSendProcessor: processed due reservations",
    );
  }

  logOperationalMetric(logger, {
    operation: "scheduler.scheduled-send",
    outcome: failedCount > 0 ? "failure" : delayedCount > 0 ? "degraded" : "success",
    durationMs: performance.now() - startedAt,
    correlationId,
    failureType: failedCount > 0 ? "delivery_failed" : delayedCount > 0 ? "delivery_delayed" : undefined,
    count: candidates.length,
    successCount: sentCount + repairedCount,
    failureCount: failedCount,
    delayedCount,
    maxDelayMs,
  });

  return { sentCount, failedCount };
}
