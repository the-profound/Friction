const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Returns the next KST 06:00 delivery slot as a UTC Date.
 * - Before 06:00 KST → 06:00 KST today
 * - At/after 06:00 KST → 06:00 KST tomorrow
 */
export function computeDeliverySlot(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstHour = kst.getUTCHours();
  const todayMidnightKST = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()),
  );
  if (kstHour < 6) {
    return new Date(todayMidnightKST.getTime() + 6 * 60 * 60 * 1000 - KST_OFFSET_MS);
  }
  const tomorrow = new Date(todayMidnightKST.getTime() + 24 * 60 * 60 * 1000);
  return new Date(tomorrow.getTime() + 6 * 60 * 60 * 1000 - KST_OFFSET_MS);
}

/**
 * Normalizes an arbitrary instant to KST 06:00 of the same KST calendar date.
 * Regardless of what date/time value a client sends, a reservation's
 * scheduledAt is always pinned to 06:00 KST of that calendar day.
 */
export function normalizeToKst6(date: Date): Date {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = kst.getUTCMonth();
  const d = kst.getUTCDate();
  return new Date(Date.UTC(y, m, d, 6, 0, 0, 0) - KST_OFFSET_MS);
}

/** Formats an instant as its KST calendar date, e.g. "2026-01-04". */
export function kstDateString(date: Date): string {
  const kst = new Date(date.getTime() + KST_OFFSET_MS);
  const y = kst.getUTCFullYear();
  const m = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(kst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
