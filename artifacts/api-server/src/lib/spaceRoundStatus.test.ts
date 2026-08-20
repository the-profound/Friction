import { describe, expect, it } from "vitest";
import { isKstDateReservable } from "./deliverySlot";
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