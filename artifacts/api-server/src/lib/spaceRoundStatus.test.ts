import { describe, expect, it } from "vitest";
import {
  computeDeliverySlot,
  isKstDateReservable,
  kstDateAt6,
  kstDateString,
} from "./deliverySlot";
import {
  isRecruitmentFull,
  startsConsumingRecruitmentPlace,
} from "./spaceRecruitment";
import { getSpaceRoundStatusForPeriod } from "./spaceRoundStatus";

describe("getSpaceRoundStatusForPeriod", () => {
  const period = {
    startsAt: new Date("2026-08-20T00:00:00.000Z"), // 2026-08-20 KST
    endsAt: new Date("2026-08-22T14:59:59.000Z"), // 2026-08-22 KST
    status: "UPCOMING" as const,
  };

  it("uses KST calendar days and keeps the end date active", () => {
    expect(
      getSpaceRoundStatusForPeriod(period, new Date("2026-08-19T14:59:59.000Z")),
    ).toBe("UPCOMING");
    expect(
      getSpaceRoundStatusForPeriod(period, new Date("2026-08-19T15:00:00.000Z")),
    ).toBe("ACTIVE");
    expect(
      getSpaceRoundStatusForPeriod(period, new Date("2026-08-22T14:59:59.000Z")),
    ).toBe("ACTIVE");
    expect(
      getSpaceRoundStatusForPeriod(period, new Date("2026-08-22T15:00:00.000Z")),
    ).toBe("COMPLETED");
  });

  it("does not override manually managed undated rounds", () => {
    expect(
      getSpaceRoundStatusForPeriod(
        { startsAt: null, endsAt: null, status: "COMPLETED" },
        new Date("2026-08-20T00:00:00.000Z"),
      ),
    ).toBe("COMPLETED");
  });
});

describe("isKstDateReservable", () => {
  it("rejects a slot at and after its KST 06:00 deadline", () => {
    const beforeDeadline = new Date("2026-08-19T20:59:59.000Z");
    const atDeadline = new Date("2026-08-19T21:00:00.000Z");

    expect(isKstDateReservable("2026-08-20", beforeDeadline)).toBe(true);
    expect(isKstDateReservable("2026-08-20", atDeadline)).toBe(false);
  });
});

describe("KST send-date normalization", () => {
  it("pins a selected calendar date to 06:00 KST", () => {
    const slot = kstDateAt6("2026-08-20");
    expect(slot?.toISOString()).toBe("2026-08-19T21:00:00.000Z");
    expect(slot ? kstDateString(slot) : null).toBe("2026-08-20");
  });

  it("rejects impossible calendar dates instead of rolling them over", () => {
    expect(kstDateAt6("2026-02-30")).toBeNull();
    expect(kstDateAt6("2026-8-20")).toBeNull();
  });

  it("moves the earliest available date at the exact 06:00 KST boundary", () => {
    const before = new Date("2026-08-19T20:59:59.999Z");
    const at = new Date("2026-08-19T21:00:00.000Z");
    expect(isKstDateReservable("2026-08-20", before)).toBe(true);
    expect(isKstDateReservable("2026-08-20", at)).toBe(false);
    expect(isKstDateReservable("2026-08-21", at)).toBe(true);
  });

  it("selects the authoritative nearest delivery instant for a catch-up send", () => {
    expect(computeDeliverySlot(new Date("2026-08-19T20:59:59.999Z")).toISOString()).toBe(
      "2026-08-19T21:00:00.000Z",
    );
    expect(computeDeliverySlot(new Date("2026-08-19T21:00:00.000Z")).toISOString()).toBe(
      "2026-08-20T21:00:00.000Z",
    );
  });
});

describe("space recruitment capacity", () => {
  it("uses the configured cap as the number of non-operator participants", () => {
    expect(isRecruitmentFull(2, 0)).toBe(false);
    expect(isRecruitmentFull(2, 1)).toBe(false);
    expect(isRecruitmentFull(2, 2)).toBe(true);
  });

  it("keeps the minimum one-person cap independent from the operator", () => {
    expect(isRecruitmentFull(1, 0)).toBe(false);
    expect(isRecruitmentFull(1, 1)).toBe(true);
  });

  it("guards each path that promotes a pending member into the cap", () => {
    const pendingParticipant = { status: "PENDING", role: "PARTICIPANT" };
    const approvedParticipant = { status: "APPROVED", role: "PARTICIPANT" };

    expect(startsConsumingRecruitmentPlace(pendingParticipant, approvedParticipant)).toBe(true);
    expect(isRecruitmentFull(2, 2)).toBe(true);
    expect(startsConsumingRecruitmentPlace(approvedParticipant, approvedParticipant)).toBe(false);
    expect(
      startsConsumingRecruitmentPlace(
        { status: "APPROVED", role: "OPERATOR" },
        { status: "APPROVED", role: "PARTICIPANT" },
      ),
    ).toBe(true);
  });
});