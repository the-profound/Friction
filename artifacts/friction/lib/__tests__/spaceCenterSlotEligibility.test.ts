import { describe, expect, it } from "vitest";
import {
  getAvailableAssignedCenterSlots,
  getSpaceRoundSlotAction,
} from "../spaceCenterSlotEligibility";

const now = new Date("2026-09-16T03:00:00.000Z");
const mine = {
  slotId: "slot-mine",
  roundId: "round-completed",
  date: "2026-09-10",
};

function send(overrides: Record<string, unknown> = {}) {
  return {
    slotId: mine.slotId,
    reservedRoundId: mine.roundId,
    reservedDate: mine.date,
    reservationAuthorId: "me",
    status: "PENDING",
    letterType: "CENTER",
    letter: { authorId: "me" },
    ...overrides,
  };
}

describe("completed-round CENTER slot eligibility", () => {
  it("renders an actionable catch-up CTA for the owner's unused past slot", () => {
    expect(
      getSpaceRoundSlotAction({
        assignedUserId: "me",
        userId: "me",
        scheduledDate: mine.date,
        hasActiveReservation: false,
        isScheduled: false,
        schedulingDisabled: false,
        now,
      }),
    ).toEqual({
      label: "지난 차례 채우기",
      accessibilityLabel: "지난 내 차례 채우기",
      catchUp: true,
    });
  });

  it("keeps another participant's same-round reservation from hiding my slot", () => {
    expect(
      getAvailableAssignedCenterSlots({
        slots: [mine],
        sends: [
          send({
            slotId: "slot-other",
            reservationAuthorId: "other",
            letter: { authorId: "other" },
          }),
        ],
        userId: "me",
        now,
        mode: "catch-up",
      }),
    ).toEqual([mine]);
  });

  it.each(["PENDING", "SENT"])("blocks the exact slot when its status is %s", (status) => {
    expect(
      getAvailableAssignedCenterSlots({
        slots: [mine],
        sends: [send({ status })],
        userId: "me",
        now,
        mode: "catch-up",
      }),
    ).toEqual([]);
  });

  it("does not let failed or cancelled history consume the slot", () => {
    expect(
      getAvailableAssignedCenterSlots({
        slots: [mine],
        sends: [send({ status: "FAILED" }), send({ status: "CANCELLED" })],
        userId: "me",
        now,
        mode: "catch-up",
      }),
    ).toEqual([mine]);
  });

  it("excludes archived, other-owner, future, and already-reserved slot actions", () => {
    const base = {
      assignedUserId: "me",
      userId: "me",
      scheduledDate: mine.date,
      hasActiveReservation: false,
      isScheduled: false,
      schedulingDisabled: false,
      now,
    };
    expect(getSpaceRoundSlotAction({ ...base, schedulingDisabled: true })).toBeNull();
    expect(getSpaceRoundSlotAction({ ...base, assignedUserId: "other" })).toBeNull();
    expect(getSpaceRoundSlotAction({ ...base, hasActiveReservation: true })).toBeNull();
    expect(
      getAvailableAssignedCenterSlots({
        slots: [{ ...mine, date: "2026-09-20" }],
        sends: [],
        userId: "me",
        now,
        mode: "catch-up",
      }),
    ).toEqual([]);
  });
});