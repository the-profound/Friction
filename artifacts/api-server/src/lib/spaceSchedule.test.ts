import { describe, expect, it } from "vitest";
import { kstDateString } from "./deliverySlot";
import { calculateOccasionDate } from "./spaceSchedule";

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