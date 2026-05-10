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
