import { kstDateString } from "./deliverySlot";

function toKstCalendarDateUtc(date: Date): Date {
  const [year, month, day] = kstDateString(date).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * Calculate the date of the Nth (0-indexed) occasion in a space schedule.
 * The input instant is first reduced to its KST calendar date, then all
 * calendar arithmetic uses UTC fields so results do not depend on host TZ.
 */
export function calculateOccasionDate(
  startedAt: Date,
  scheduleType: "N_DAY" | "WEEKDAY",
  intervalDays: number,
  weekdays: number[],
  occasionIndex: number,
): Date | null {
  const base = toKstCalendarDateUtc(startedAt);

  if (scheduleType === "N_DAY") {
    base.setUTCDate(base.getUTCDate() + occasionIndex * intervalDays);
    return base;
  }
  if (scheduleType === "WEEKDAY" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    let found = 0;
    for (let attempt = 0; attempt < 3650; attempt++) {
      if (sorted.includes(base.getUTCDay())) {
        if (found === occasionIndex) return new Date(base);
        found++;
      }
      base.setUTCDate(base.getUTCDate() + 1);
    }
  }
  return null;
}