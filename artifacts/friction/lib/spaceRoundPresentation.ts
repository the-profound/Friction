import { kstDateAt6, toKstCalendarDate } from "./kstDate";

export type SpaceRoundPresentation = {
  roundNumber: number;
};

export type DatedSpaceRoundPresentation = SpaceRoundPresentation & {
  status: string;
  startsAt?: string | Date | null;
  endsAt?: string | Date | null;
};

export function getSpaceRoundPresentationStatus(
  round: DatedSpaceRoundPresentation,
  now: Date = new Date(),
): string {
  if (!round.startsAt) return round.status;

  const today = toKstCalendarDate(now).getTime();
  const startsOn = toKstCalendarDate(new Date(round.startsAt)).getTime();
  if (today < startsOn) return "UPCOMING";

  if (round.endsAt && today > toKstCalendarDate(new Date(round.endsAt)).getTime()) {
    return "COMPLETED";
  }

  return "ACTIVE";
}

function parseKstDateString(ymd: string): Date | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!matched) return null;
  return new Date(Number(matched[1]), Number(matched[2]) - 1, Number(matched[3]));
}

/** A slot remains reservable only until its KST 06:00 send instant. */
export function isKstSlotReservable(ymd: string | null | undefined, now: Date = new Date()): boolean {
  if (!ymd) return false;
  const date = parseKstDateString(ymd);
  return !!date && kstDateAt6(date).getTime() > now.getTime();
}

/** Opening letters use the round's KST start calendar date as their deadline. */
export function isOpeningSlotReservable(
  startsAt: string | Date | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!startsAt) return false;
  const date = toKstCalendarDate(new Date(startsAt));
  return kstDateAt6(date).getTime() > now.getTime();
}

export type SpaceRoundSlotPresentation = {
  scheduledDate?: string | null;
  slotOrder: number;
};

type SpaceRoundCenterLetterMatch = {
  id: string;
  spaceRoundId?: string | null;
  authorId: string;
  letterType: string | null | undefined;
};

type SpaceRoundSlotAssignment = {
  id: string;
  spaceRoundId: string;
  assignedUserId: string;
};

type PendingCenterReservation = {
  spaceLetterId: string;
  slotId?: string | null;
};

export type UpcomingRoundCenterCardItem<
  TLetter extends SpaceRoundCenterLetterMatch,
  TSlot extends SpaceRoundSlotAssignment,
> =
  | { kind: "letter"; letter: TLetter; slotId: string }
  | { kind: "slot"; slot: TSlot };

/**
 * Resolves only the current user's pending CENTER reservations to their exact
 * round assignments. Other participants' upcoming reservations deliberately
 * remain slots, so their articles are never exposed before their send time.
 */
export function resolveUpcomingRoundCenterCards<
  TLetter extends SpaceRoundCenterLetterMatch,
  TSlot extends SpaceRoundSlotAssignment,
>(
  letters: readonly TLetter[],
  slots: readonly TSlot[],
  userId: string,
  pendingCenterReservations: readonly PendingCenterReservation[],
): UpcomingRoundCenterCardItem<TLetter, TSlot>[] {
  const slotsByRoundAndAssignee = new Map(
    slots.map((slot) => [`${slot.spaceRoundId}:${slot.assignedUserId}`, slot]),
  );
  const slotsById = new Map(slots.map((slot) => [slot.id, slot]));
  const reservationsByLetterId = new Map(
    pendingCenterReservations.map((reservation) => [
      reservation.spaceLetterId,
      reservation,
    ]),
  );
  const lettersBySlotId = new Map<string, TLetter>();

  for (const letter of letters) {
    if (
      letter.letterType !== "CENTER" ||
      letter.authorId !== userId ||
      !letter.spaceRoundId
    ) {
      continue;
    }

    const reservation = reservationsByLetterId.get(letter.id);
    if (!reservation) continue;

    // New reservations persist the chosen slot ID. Old reservations without
    // that field can only use the explicit round + assigned-user fallback.
    const slot = reservation.slotId
      ? slotsById.get(reservation.slotId)
      : slotsByRoundAndAssignee.get(
          `${letter.spaceRoundId}:${letter.authorId}`,
        );
    if (
      !slot ||
      slot.spaceRoundId !== letter.spaceRoundId ||
      slot.assignedUserId !== letter.authorId ||
      lettersBySlotId.has(slot.id)
    ) {
      continue;
    }

    lettersBySlotId.set(slot.id, letter);
  }

  return slots.map((slot) => {
    const letter = lettersBySlotId.get(slot.id);
    return letter
      ? { kind: "letter", letter, slotId: slot.id }
      : { kind: "slot", slot };
  });
}

/** Keeps reservable cards ahead of expired empty slots without changing their internal order. */
export function sortSpaceRoundSlotsForPresentation<T extends SpaceRoundSlotPresentation>(
  slots: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...slots].sort((a, b) => {
    const aExpired = !!a.scheduledDate && !isKstSlotReservable(a.scheduledDate, now);
    const bExpired = !!b.scheduledDate && !isKstSlotReservable(b.scheduledDate, now);
    if (aExpired !== bExpired) return aExpired ? 1 : -1;
    if (a.scheduledDate && b.scheduledDate) return a.scheduledDate.localeCompare(b.scheduledDate);
    if (a.scheduledDate) return -1;
    if (b.scheduledDate) return 1;
    return a.slotOrder - b.slotOrder;
  });
}

/** Anonymous letters always use the server-provided safe per-space display name. */
export function getSpaceLetterAuthorName(
  _letterType: string | null | undefined,
  isAnonymous: boolean,
  displayName: string | null | undefined,
  authorNickname: string | null | undefined,
): string | undefined {
  if (isAnonymous) return displayName ?? "참여자";
  return authorNickname ?? "알 수 없음";
}

export function roundStatusLabel(status: string): string {
  if (status === "ACTIVE") return "진행 중";
  if (status === "UPCOMING") return "예정";
  if (status === "COMPLETED") return "종료";
  return status;
}

export function sortSpaceRoundsNewestFirst<T extends SpaceRoundPresentation>(
  rounds: readonly T[],
): T[] {
  return [...rounds].sort((a, b) => b.roundNumber - a.roundNumber);
}

const SPACE_DETAIL_STATUS_ORDER: Record<string, number> = {
  ACTIVE: 0,
  UPCOMING: 1,
  COMPLETED: 2,
};

function getDateTimestamp(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

/**
 * Orders rounds for the space detail carousel by the status users see there:
 * active, upcoming, then completed. Date ordering is only used when both
 * rounds in a group have valid dates; otherwise round number keeps the result
 * deterministic without relying on the API response order.
 */
export function sortSpaceRoundsForDetail<T extends DatedSpaceRoundPresentation>(
  rounds: readonly T[],
  now: Date = new Date(),
): T[] {
  return [...rounds].sort((a, b) => {
    const aStatus = getSpaceRoundPresentationStatus(a, now);
    const bStatus = getSpaceRoundPresentationStatus(b, now);
    const statusDifference =
      (SPACE_DETAIL_STATUS_ORDER[aStatus] ?? Number.MAX_SAFE_INTEGER) -
      (SPACE_DETAIL_STATUS_ORDER[bStatus] ?? Number.MAX_SAFE_INTEGER);

    if (statusDifference !== 0) return statusDifference;

    if (aStatus === "UPCOMING" && bStatus === "UPCOMING") {
      const aStartsAt = getDateTimestamp(a.startsAt);
      const bStartsAt = getDateTimestamp(b.startsAt);
      if (aStartsAt !== null && bStartsAt !== null && aStartsAt !== bStartsAt) {
        return aStartsAt - bStartsAt;
      }
    } else if (aStatus === "COMPLETED" && bStatus === "COMPLETED") {
      const aEndsAt = getDateTimestamp(a.endsAt);
      const bEndsAt = getDateTimestamp(b.endsAt);
      if (aEndsAt !== null && bEndsAt !== null && aEndsAt !== bEndsAt) {
        return bEndsAt - aEndsAt;
      }
    }

    return b.roundNumber - a.roundNumber;
  });
}

/**
 * Completed-round covers stay vivid in the space detail carousel. Other letter
 * lists retain the shared card's normal read-state dimming.
 */
export function shouldDimSpaceRoundLetter(
  roundStatus: string,
  isRead: boolean | null | undefined,
): boolean {
  return roundStatus !== "COMPLETED" && !!isRead;
}