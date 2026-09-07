import { beforeEach, describe, expect, it, vi } from "vitest";

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
const { runScheduledSendSweep, notifyLetterArrivalsForSlot } = await import("./scheduler");

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
