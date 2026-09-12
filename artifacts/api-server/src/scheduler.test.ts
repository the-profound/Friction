import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression coverage for the missed 06:00 letter-arrived push scenario:
 * a space-letter reservation's sweep-driven inbox insert can commit several
 * minutes after the independent 06:00 KST notification timer already ran
 * and found nothing for that slot. `runScheduledSendSweep` must re-trigger
 * the notification job for exactly the slots it just committed rows for,
 * and the underlying claim must make repeat triggers for the same slot
 * (sweep now, timer later, or vice versa) notify each recipient once —
 * never zero, never twice.
 */

vi.mock("@workspace/db", () => ({
  db: {},
  spacesTable: {},
  spaceParticipationsTable: {},
}));

vi.mock("./lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./lib/notifications", () => ({
  dispatchNotification: vi.fn(),
}));

vi.mock("./lib/letterNotificationQuery", () => ({
  claimNewLetterRecipientsForSlot: vi.fn(),
  confirmLetterNotificationSent: vi.fn(),
  releaseLetterNotificationClaim: vi.fn(),
  findDeliverySlotsNeedingLetterPushRetry: vi.fn(),
}));

vi.mock("./lib/pushSender", () => ({
  sendPush: vi.fn(),
}));

vi.mock("./lib/scheduledSendProcessor", () => ({
  processDueScheduledSends: vi.fn(),
}));

vi.mock("./lib/spaceRoundStatus", () => ({
  synchronizeSpaceRoundStatuses: vi.fn(),
}));

const {
  claimNewLetterRecipientsForSlot,
  confirmLetterNotificationSent,
  releaseLetterNotificationClaim,
  findDeliverySlotsNeedingLetterPushRetry,
} = await import("./lib/letterNotificationQuery");
const { sendPush } = await import("./lib/pushSender");
const { processDueScheduledSends } = await import("./lib/scheduledSendProcessor");
const { synchronizeSpaceRoundStatuses } = await import("./lib/spaceRoundStatus");
const { runScheduledSendSweep, notifyLetterArrivalsForSlot, startScheduler } = await import(
  "./scheduler"
);

// The exact production slot from the incident: 2026-09-08 06:00:00 KST.
const SLOT = new Date("2026-09-08T06:00:00.000+09:00");

const recipient = {
  userId: "user-1",
  nickname: "민지",
  newLetterCount: 1,
  leaseId: "lease-1",
  claimedThroughSequence: 1,
  pushTokens: [{ token: "token-1", platform: "ios" }],
};

describe("runScheduledSendSweep — post-delivery notification recheck", () => {
  beforeEach(() => {
    vi.mocked(claimNewLetterRecipientsForSlot).mockReset();
    vi.mocked(sendPush).mockReset().mockResolvedValue([{ success: true }] as any);
    vi.mocked(processDueScheduledSends).mockReset();
    vi.mocked(synchronizeSpaceRoundStatuses).mockReset().mockResolvedValue(undefined as any);
    vi.mocked(confirmLetterNotificationSent).mockReset().mockResolvedValue(undefined);
    vi.mocked(releaseLetterNotificationClaim).mockReset().mockResolvedValue(undefined);
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockReset().mockResolvedValue([]);
  });

  it("notifies the recipient once when the sweep's delayed delivery lands the slot's inbox rows after the 06:00 timer already ran and found nothing", async () => {
    // Reproduces the incident: the sweep just committed rows for SLOT
    // (this is what "affectedSlots" surfaces).
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 36,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    // The independent 06:00 timer already ran moments earlier and found 0
    // recipients (nothing had been claimed for SLOT yet); the sweep's
    // recheck is the first to actually find and claim the recipient.
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);

    await runScheduledSendSweep();

    expect(processDueScheduledSends).toHaveBeenCalledTimes(1);
    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledTimes(1);
    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledWith(SLOT);
    expect(sendPush).toHaveBeenCalledTimes(1);

    // A later run of the 06:00-timer-driven job for the same slot (e.g. the
    // process restarted, or a duplicate trigger) must not double-notify:
    // the durable claim means the query returns nothing the second time.
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([]);
    await notifyLetterArrivalsForSlot(SLOT);

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledTimes(2);
    // No new push sent for the already-claimed recipient.
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("never skips the recheck when no reservation was due — affectedSlots is empty and no notification job runs", async () => {
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });

    await runScheduledSendSweep();

    expect(claimNewLetterRecipientsForSlot).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("still triggers the notification recheck when the unrelated round-status sync fails", async () => {
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    vi.mocked(synchronizeSpaceRoundStatuses).mockRejectedValue(new Error("round status sync boom"));
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);

    await expect(runScheduledSendSweep()).resolves.not.toThrow();

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledWith(SLOT);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("still runs retry-discovery (but finds no affected/retry slots) when the scheduled-send sweep itself fails, and never throws", async () => {
    vi.mocked(processDueScheduledSends).mockRejectedValue(new Error("db unavailable"));

    await expect(runScheduledSendSweep()).resolves.not.toThrow();

    // Retry discovery must still run — it is the only guaranteed trigger for
    // a released/stale-locked claim and must not be starved by an unrelated,
    // persistent reservation-processing failure.
    expect(findDeliverySlotsNeedingLetterPushRetry).toHaveBeenCalledTimes(1);
    // With no affectedSlots (the failure short-circuited before producing
    // any) and no retry-discovery hits, there is nothing to notify.
    expect(claimNewLetterRecipientsForSlot).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
  });

  it("retries a slot found only by retry-discovery even when processDueScheduledSends fails on the very same tick", async () => {
    vi.mocked(processDueScheduledSends).mockRejectedValue(new Error("db unavailable"));
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockResolvedValueOnce([SLOT]);
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);

    await expect(runScheduledSendSweep()).resolves.not.toThrow();

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledWith(SLOT);
    expect(sendPush).toHaveBeenCalledTimes(1);
  });

  it("notifying two affected slots in one sweep run is independent per slot", async () => {
    const otherSlot = new Date(SLOT.getTime() + 24 * 60 * 60 * 1000);
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 2,
      failedCount: 0,
      affectedSlots: [SLOT, otherSlot],
    });
    vi.mocked(claimNewLetterRecipientsForSlot)
      .mockResolvedValueOnce([recipient])
      .mockResolvedValueOnce([{ ...recipient, userId: "user-2" }]);

    await runScheduledSendSweep();

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledTimes(2);
    expect(claimNewLetterRecipientsForSlot).toHaveBeenNthCalledWith(1, SLOT);
    expect(claimNewLetterRecipientsForSlot).toHaveBeenNthCalledWith(2, otherSlot);
    expect(sendPush).toHaveBeenCalledTimes(2);
  });

  it("releases the claim (instead of confirming it) when the push genuinely fails to send, so a later trigger for the same slot can retry it", async () => {
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);
    vi.mocked(sendPush).mockResolvedValueOnce([
      { userId: recipient.userId, token: "token-1", success: false, error: "chunk_send_failed" },
    ] as any);

    await notifyLetterArrivalsForSlot(SLOT);

    expect(releaseLetterNotificationClaim).toHaveBeenCalledWith(
      recipient.userId,
      SLOT,
      recipient.leaseId,
    );
    expect(confirmLetterNotificationSent).not.toHaveBeenCalled();

    // A later trigger for the same slot (the query layer's own tests cover
    // that a released claim is re-claimable, with a fresh lease) finds the
    // recipient again and this time the push succeeds — it must be
    // confirmed, not re-released.
    const retriedRecipient = { ...recipient, leaseId: "lease-2" };
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([retriedRecipient]);
    vi.mocked(sendPush).mockResolvedValueOnce([
      { userId: recipient.userId, token: "token-1", success: true },
    ] as any);

    await notifyLetterArrivalsForSlot(SLOT);

    expect(confirmLetterNotificationSent).toHaveBeenCalledWith(
      retriedRecipient.userId,
      SLOT,
      retriedRecipient.leaseId,
      retriedRecipient.claimedThroughSequence,
    );
    expect(releaseLetterNotificationClaim).toHaveBeenCalledTimes(1);
  });

  it("confirms only the recipients whose push actually succeeded within a batch — a same-batch failure never gets confirmed, and vice versa", async () => {
    const succeeding = { ...recipient, userId: "user-a", leaseId: "lease-a", claimedThroughSequence: 2 };
    const failing = { ...recipient, userId: "user-b", leaseId: "lease-b", claimedThroughSequence: 3 };
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([succeeding, failing]);
    vi.mocked(sendPush)
      .mockResolvedValueOnce([{ userId: "user-a", token: "token-1", success: true }] as any)
      .mockResolvedValueOnce([
        { userId: "user-b", token: "token-1", success: false, error: "chunk_send_failed" },
      ] as any);

    await notifyLetterArrivalsForSlot(SLOT);

    expect(confirmLetterNotificationSent).toHaveBeenCalledWith("user-a", SLOT, "lease-a", 2);
    expect(confirmLetterNotificationSent).not.toHaveBeenCalledWith("user-b", SLOT, "lease-b", 3);
    expect(releaseLetterNotificationClaim).toHaveBeenCalledWith("user-b", SLOT, "lease-b");
    expect(releaseLetterNotificationClaim).not.toHaveBeenCalledWith("user-a", SLOT, "lease-a");
  });

  it("a second same-slot batch committed by a later sweep run produces exactly one additional push with the correct incremental count", async () => {
    const firstWave = { ...recipient, newLetterCount: 2, leaseId: "lease-1", claimedThroughSequence: 2 };
    vi.mocked(processDueScheduledSends).mockResolvedValueOnce({
      sentCount: 2,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([firstWave]);

    await runScheduledSendSweep();

    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(confirmLetterNotificationSent).toHaveBeenCalledWith(recipient.userId, SLOT, "lease-1", 2);

    // A second, independent batch of reservations commits more inbox rows
    // for the exact same slot on a later sweep run — claimed under a fresh
    // lease, since the earlier claim was already resolved.
    const secondWave = { ...recipient, newLetterCount: 3, leaseId: "lease-2", claimedThroughSequence: 5 };
    vi.mocked(processDueScheduledSends).mockResolvedValueOnce({
      sentCount: 3,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([secondWave]);

    await runScheduledSendSweep();

    expect(sendPush).toHaveBeenCalledTimes(2);
    // The follow-up push reports only the newly-arrived delta (3), not the
    // cumulative total (5).
    expect(sendPush).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ newLetterCount: 3 }),
      expect.anything(),
    );
    expect(confirmLetterNotificationSent).toHaveBeenCalledWith(recipient.userId, SLOT, "lease-2", 5);
  });

  it("rechecks a slot with no new reservation activity when the query layer reports it needs a push retry — this is what actually retries a released/stale-locked claim in production", async () => {
    // No reservations were due this tick — affectedSlots is empty — but a
    // recipient's push genuinely failed on an earlier trigger and its claim
    // was released, so the periodic retry-discovery query now surfaces SLOT.
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockResolvedValueOnce([SLOT]);
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);

    await runScheduledSendSweep();

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledWith(SLOT);
    expect(sendPush).toHaveBeenCalledTimes(1);
    expect(confirmLetterNotificationSent).toHaveBeenCalledWith(
      recipient.userId,
      SLOT,
      recipient.leaseId,
      recipient.claimedThroughSequence,
    );
  });

  it("does not double-recheck a slot that is both freshly affected and reported by the retry-discovery query in the same tick", async () => {
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    // The retry-discovery query can legitimately also report SLOT (e.g. a
    // different recipient's earlier release still unresolved) — the sweep
    // must recheck the slot once, not twice.
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockResolvedValueOnce([SLOT]);
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);

    await runScheduledSendSweep();

    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledTimes(1);
    expect(claimNewLetterRecipientsForSlot).toHaveBeenCalledWith(SLOT);
  });

  it("still rechecks the retry-discovery slots when the retry-discovery query itself fails for one tick, without throwing", async () => {
    vi.mocked(processDueScheduledSends).mockResolvedValue({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockRejectedValueOnce(
      new Error("db unavailable"),
    );

    await expect(runScheduledSendSweep()).resolves.not.toThrow();

    expect(claimNewLetterRecipientsForSlot).not.toHaveBeenCalled();
  });

  it("the released-claim-then-periodic-retry path notifies exactly once — never zero, never twice", async () => {
    // Tick 1: the recipient's push fails and the claim is released.
    vi.mocked(processDueScheduledSends).mockResolvedValueOnce({
      sentCount: 1,
      failedCount: 0,
      affectedSlots: [SLOT],
    });
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([recipient]);
    vi.mocked(sendPush).mockResolvedValueOnce([
      { userId: recipient.userId, token: "token-1", success: false, error: "chunk_send_failed" },
    ] as any);

    await runScheduledSendSweep();

    expect(releaseLetterNotificationClaim).toHaveBeenCalledWith(
      recipient.userId,
      SLOT,
      recipient.leaseId,
    );
    expect(sendPush).toHaveBeenCalledTimes(1);

    // Tick 2: no new reservation activity, but the retry-discovery query
    // now surfaces SLOT (the query layer's own tests cover that a released
    // claim is durably discoverable, with a fresh lease) and the retry
    // succeeds.
    const retriedRecipient = { ...recipient, leaseId: "lease-2" };
    vi.mocked(processDueScheduledSends).mockResolvedValueOnce({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockResolvedValueOnce([SLOT]);
    vi.mocked(claimNewLetterRecipientsForSlot).mockResolvedValueOnce([retriedRecipient]);
    vi.mocked(sendPush).mockResolvedValueOnce([
      { userId: recipient.userId, token: "token-1", success: true },
    ] as any);

    await runScheduledSendSweep();

    expect(sendPush).toHaveBeenCalledTimes(2);
    expect(confirmLetterNotificationSent).toHaveBeenCalledWith(
      retriedRecipient.userId,
      SLOT,
      retriedRecipient.leaseId,
      retriedRecipient.claimedThroughSequence,
    );
    expect(confirmLetterNotificationSent).toHaveBeenCalledTimes(1);
    expect(releaseLetterNotificationClaim).toHaveBeenCalledTimes(1);
  });
});

/**
 * Regression coverage for the exact-06:00 delivery sweep trigger (closing the
 * remaining gap from the incident above at the source): a reservation due
 * right at 06:00 KST must not have to wait for the next 5-minute periodic
 * poll. `startScheduler` now fires `runScheduledSendSweep` once exactly at
 * the next 06:00 KST — the same timer that already drives the letter-arrived
 * push recheck — in addition to the pre-existing 5-minute interval.
 */
describe("startScheduler — exact-06:00 KST trigger for the delivery sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(processDueScheduledSends).mockReset().mockResolvedValue({
      sentCount: 0,
      failedCount: 0,
      affectedSlots: [],
    });
    vi.mocked(claimNewLetterRecipientsForSlot).mockReset().mockResolvedValue([]);
    vi.mocked(synchronizeSpaceRoundStatuses).mockReset().mockResolvedValue(undefined as any);
    vi.mocked(findDeliverySlotsNeedingLetterPushRetry).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the scheduled-send sweep exactly at the next 06:00 KST — ahead of both the 5-minute periodic poll and without waiting for it", async () => {
    // Exactly 1 hour before the next 06:00 KST slot.
    vi.setSystemTime(new Date("2026-09-08T05:00:00.000+09:00"));

    startScheduler();

    // Startup catch-up sweep fires at +8s, per the pre-existing 5-minute
    // interval wiring (unchanged by this task).
    await vi.advanceTimersByTimeAsync(8_000);
    expect(processDueScheduledSends).toHaveBeenCalledTimes(1);
    vi.mocked(processDueScheduledSends).mockClear();

    // Advance to 05:59:00. The periodic 5-minute interval (anchored at the
    // +8s startup run) ticks repeatedly in this window — that's expected
    // and irrelevant to this test, so clear it out.
    await vi.advanceTimersByTimeAsync(59 * 60 * 1000 - 8_000);
    vi.mocked(processDueScheduledSends).mockClear();

    // One second before 06:00 KST: neither the exact-06:00 trigger nor the
    // next periodic tick (which lands at 06:00:08) has fired yet.
    await vi.advanceTimersByTimeAsync(59_000);
    expect(processDueScheduledSends).not.toHaveBeenCalled();

    // Crossing 06:00:00 KST — the new exact-time trigger fires here, still
    // ~8 seconds ahead of the next periodic 5-minute tick.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(processDueScheduledSends).toHaveBeenCalled();
  });
});
