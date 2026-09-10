export type ReservationIntentAction =
  | "wait"
  | "open-slot-picker"
  | "blocked"
  | "unresolved-slot"
  | "no-slots";

export function resolveReservationIntentAction({
  articleQueryPending,
  eligibilityPending,
  isSchedulingBlocked,
  slotCount,
  hasUnresolvedCenterAssignment,
}: {
  articleQueryPending: boolean;
  eligibilityPending: boolean;
  isSchedulingBlocked: boolean;
  slotCount: number;
  hasUnresolvedCenterAssignment: boolean;
}): ReservationIntentAction {
  if (articleQueryPending || eligibilityPending) return "wait";
  if (isSchedulingBlocked) return "blocked";
  if (slotCount > 0) return "open-slot-picker";
  return hasUnresolvedCenterAssignment ? "unresolved-slot" : "no-slots";
}