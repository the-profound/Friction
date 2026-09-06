import { describe, expect, it } from "vitest";
import { kstDateString } from "./deliverySlot";
import {
  calculateOccasionDate,
  calculateSlotOccasionIndex,
} from "./spaceSchedule";

describe("calculateOccasionDate", () => {
  it("maps a Saturday Sep 5 KST start to Monday Sep 7 for a Monday schedule", () => {
    const start = new Date("2026-09-04T15:00:00.000Z");
    const firstMonday = calculateOccasionDate(start, "WEEKDAY", 7, [1], 0);

    expect(firstMonday && kstDateString(firstMonday)).toBe("2026-09-07");
  });

  it("keeps N-day calendar arithmetic on KST dates", () => {
    const start = new Date("2026-09-04T15:00:00.000Z");
    const thirdOccasion = calculateOccasionDate(start, "N_DAY", 2, [], 2);

    expect(thirdOccasion && kstDateString(thirdOccasion)).toBe("2026-09-09");
  });
});

describe("calculateSlotOccasionIndex", () => {
  it("groups two center-article slots onto each schedule occasion", () => {
    expect([0, 1, 2, 3, 4].map((position) =>
      calculateSlotOccasionIndex(position, 2)
    )).toEqual([0, 0, 1, 1, 2]);
  });

  it("keeps one slot per occasion when center count is one", () => {
    expect([0, 1, 2].map((position) =>
      calculateSlotOccasionIndex(position, 1)
    )).toEqual([0, 1, 2]);
  });

  it("safely treats an invalid center count as one", () => {
    expect(calculateSlotOccasionIndex(3, 0)).toBe(3);
  });
});