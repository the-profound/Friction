/**
 * Processes due space-letter reservations (`space_scheduled_sends`).
 *
 * A reservation is "due" once its `scheduledAt` (always KST 06:00) has
 * passed. Once due, it must transition out of PENDING so it never lingers
 * as "대기 중" (pending) on the reservation list:
 *   - SENT + sentAt: the normal case — the reservation is honored.
 *   - FAILED + failureReason: the underlying letter/article was deleted, or
 *     the space was archived before the reservation could be honored.
 *
 * This is called from two places:
 *   1. The periodic scheduler job (`scheduler.ts`), which sweeps the whole
 *      table so reservations are caught up even if the process was down.
 *   2. Read paths (`GET .../scheduled-sends`) that scope the sweep to a
 *      single space, so a user never sees a "PENDING" reservation whose
 *      time has already passed, even if the periodic job hasn't run yet.
 *
 * All transitions are guarded by `WHERE status = 'PENDING'`, so concurrent
 * callers (multiple server instances, or a read-path sweep racing the
 * periodic job) can never double-process the same row.
 */
import { db, spaceScheduledSendsTable, spaceLettersTable, articlesTable, spacesTable } from "@workspace/db";
import { eq, and, lte, inArray } from "drizzle-orm";
import { logger } from "./logger";

export interface ProcessDueScheduledSendsResult {
  sentCount: number;
  failedCount: number;
}

export async function processDueScheduledSends(opts?: {
  spaceId?: string;
}): Promise<ProcessDueScheduledSendsResult> {
  const now = new Date();
  const conditions = [
    eq(spaceScheduledSendsTable.status, "PENDING"),
    lte(spaceScheduledSendsTable.scheduledAt, now),
  ];
  if (opts?.spaceId) {
    conditions.push(eq(spaceScheduledSendsTable.spaceId, opts.spaceId));
  }

  const due = await db
    .select({
      id: spaceScheduledSendsTable.id,
      spaceId: spaceScheduledSendsTable.spaceId,
      spaceLetterId: spaceScheduledSendsTable.spaceLetterId,
    })
    .from(spaceScheduledSendsTable)
    .where(and(...conditions));

  if (due.length === 0) {
    return { sentCount: 0, failedCount: 0 };
  }

  const letterIds = [...new Set(due.map((d) => d.spaceLetterId))];
  const spaceIds = [...new Set(due.map((d) => d.spaceId))];

  const [letters, spaces] = await Promise.all([
    db.select().from(spaceLettersTable).where(inArray(spaceLettersTable.id, letterIds)),
    db
      .select({ id: spacesTable.id, status: spacesTable.status })
      .from(spacesTable)
      .where(inArray(spacesTable.id, spaceIds)),
  ]);
  const letterMap = new Map(letters.map((l) => [l.id, l]));
  const spaceStatusMap = new Map(spaces.map((s) => [s.id, s.status]));

  const articleIds = [
    ...new Set(letters.map((l) => l.sourceArticleId).filter((id): id is string => !!id)),
  ];
  const articles = articleIds.length > 0
    ? await db
        .select({ id: articlesTable.id, deletedAt: articlesTable.deletedAt })
        .from(articlesTable)
        .where(inArray(articlesTable.id, articleIds))
    : [];
  const deletedArticleIds = new Set(articles.filter((a) => a.deletedAt != null).map((a) => a.id));
  const existingArticleIds = new Set(articles.map((a) => a.id));

  const okIds: string[] = [];
  const failures = new Map<string, string>();

  for (const send of due) {
    const letter = letterMap.get(send.spaceLetterId);
    if (!letter) {
      failures.set(send.id, "원본 글을 찾을 수 없습니다.");
      continue;
    }
    const spaceStatus = spaceStatusMap.get(send.spaceId);
    if (spaceStatus === "ARCHIVED") {
      failures.set(send.id, "공간이 종료되어 발송할 수 없습니다.");
      continue;
    }
    if (
      letter.sourceArticleId &&
      (deletedArticleIds.has(letter.sourceArticleId) || !existingArticleIds.has(letter.sourceArticleId))
    ) {
      failures.set(send.id, "원본 글이 삭제되어 발송할 수 없습니다.");
      continue;
    }
    okIds.push(send.id);
  }

  let sentCount = 0;
  let failedCount = 0;

  await db.transaction(async (tx) => {
    if (okIds.length > 0) {
      const sent = await tx
        .update(spaceScheduledSendsTable)
        .set({ status: "SENT", sentAt: now })
        .where(
          and(
            eq(spaceScheduledSendsTable.status, "PENDING"),
            inArray(spaceScheduledSendsTable.id, okIds),
          ),
        )
        .returning({ id: spaceScheduledSendsTable.id });
      sentCount = sent.length;
    }

    // Group failures by reason so each distinct reason is one UPDATE.
    const byReason = new Map<string, string[]>();
    for (const [id, reason] of failures) {
      const bucket = byReason.get(reason) ?? [];
      bucket.push(id);
      byReason.set(reason, bucket);
    }
    for (const [reason, ids] of byReason) {
      const failed = await tx
        .update(spaceScheduledSendsTable)
        .set({ status: "FAILED", failureReason: reason })
        .where(
          and(
            eq(spaceScheduledSendsTable.status, "PENDING"),
            inArray(spaceScheduledSendsTable.id, ids),
          ),
        )
        .returning({ id: spaceScheduledSendsTable.id });
      failedCount += failed.length;
    }
  });

  if (sentCount > 0 || failedCount > 0) {
    logger.info(
      { sentCount, failedCount, spaceId: opts?.spaceId },
      "scheduledSendProcessor: processed due reservations",
    );
  }

  return { sentCount, failedCount };
}
