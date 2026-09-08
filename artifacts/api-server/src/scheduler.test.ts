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

const { claimNewLetterRecipientsForSlot } = await import("./lib/letterNotificationQuery");
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
  pushTokens: [{ token: "token-1", platform: "ios" }],
};

describe("runScheduledSendSweep — post-delivery notification recheck", () => {
  beforeEach(() => {
    vi.mocked(claimNewLetterRecipientsForSlot).mockReset();
    vi.mocked(sendPush).mockReset().mockResolvedValue([{ success: true }] as any);
    vi.mocked(processDueScheduledSends).mockReset();
    vi.mocked(synchronizeSpaceRoundStatuses).mockReset().mockResolvedValue(undefined as any);
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

  it("does not run the notification job at all when the scheduled-send sweep itself fails", async () => {
    vi.mocked(processDueScheduledSends).mockRejectedValue(new Error("db unavailable"));

    await expect(runScheduledSendSweep()).resolves.not.toThrow();

    expect(claimNewLetterRecipientsForSlot).not.toHaveBeenCalled();
    expect(sendPush).not.toHaveBeenCalled();
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
