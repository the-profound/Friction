type SlotReservationState = {
  slotId: string | null;
  status: "PENDING" | "SENT" | "CANCELLED" | "FAILED";
};

export function getActivelyReservedSlotIds(
  reservations: SlotReservationState[],
): Set<string> {
  return new Set(
    reservations.flatMap(({ slotId, status }) =>
      slotId && status === "PENDING" ? [slotId] : [],
    ),
  );
}