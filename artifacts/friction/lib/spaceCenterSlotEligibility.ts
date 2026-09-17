import { isKstSlotReservable } from "./spaceRoundPresentation";

export type CenterSlotIdentity = {
  slotId: string;
  date: string;
  roundId: string;
};

type CenterSlotSend = {
  slotId?: string | null;
  reservedRoundId?: string | null;
  reservedDate?: string | Date | null;
  reservationAuthorId?: string | null;
  status: string;
  letterType?: string | null;
  letter?: { authorId?: string | null } | null;
  reservation?: {
    slotId?: string | null;
    roundId?: string | null;
    date?: string | Date | null;
    authorId?: string | null;
  } | null;
};

function asDateString(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function doesCenterSendOccupySlot(
  send: CenterSlotSend,
  slot: CenterSlotIdentity,
  userId: string,
): boolean {
  if (
    (send.status !== "PENDING" && send.status !== "SENT") ||
    send.letterType !== "CENTER" ||
    send.letter?.authorId !== userId
  ) {
    return false;
  }

  const reservation = send.reservation;
  const slotId = reservation?.slotId ?? send.slotId ?? null;
  const roundId = reservation?.roundId ?? send.reservedRoundId ?? null;
  const authorId =
    reservation?.authorId ?? send.reservationAuthorId ?? send.letter?.authorId ?? null;
  const date = asDateString(reservation?.date ?? send.reservedDate);

  return (
    slotId === slot.slotId &&
    roundId === slot.roundId &&
    authorId === userId &&
    date === slot.date
  );
}

export function getAvailableAssignedCenterSlots({
  slots,
  sends,
  userId,
  now,
  mode,
}: {
  slots: CenterSlotIdentity[] | undefined;
  sends: CenterSlotSend[];
  userId: string;
  now: Date;
  mode: "upcoming" | "catch-up";
}): CenterSlotIdentity[] | undefined {
  return slots?.filter((slot) => {
    const isUpcoming = isKstSlotReservable(slot.date, now);
    if ((mode === "upcoming") !== isUpcoming) return false;
    return !sends.some((send) => doesCenterSendOccupySlot(send, slot, userId));
  });
}

export function getSpaceRoundSlotAction({
  assignedUserId,
  userId,
  scheduledDate,
  hasActiveReservation,
  isScheduled,
  schedulingDisabled,
  now,
}: {
  assignedUserId: string;
  userId: string;
  scheduledDate?: string | null;
  hasActiveReservation: boolean;
  isScheduled: boolean;
  schedulingDisabled: boolean;
  now: Date;
}): { label: string; accessibilityLabel?: string; catchUp: boolean } | null {
  if (
    assignedUserId !== userId ||
    isScheduled ||
    hasActiveReservation ||
    schedulingDisabled
  ) {
    return null;
  }
  const catchUp = !!scheduledDate && !isKstSlotReservable(scheduledDate, now);
  return catchUp
    ? {
        label: "지난 차례 채우기",
        accessibilityLabel: "지난 내 차례 채우기",
        catchUp: true,
      }
    : { label: "글 예약하기", catchUp: false };
}