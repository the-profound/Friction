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
  reservation?: SpaceReservationMetadataPresentation | null;
  everScheduled?: boolean;
  lastReservation?: SpaceReservationMetadataPresentation | null;
};

type SpaceRoundSlotAssignment = {
  id: string;
  spaceRoundId: string;
  assignedUserId: string;
  scheduledDate?: string | null;
};

export type SpaceReservationMetadataPresentation = {
  status: string;
  scheduledAt: string;
  roundId: string | null;
  date: string | null;
  slotId: string | null;
  authorId: string | null;
  resolved: boolean;
};

type PendingCenterReservation = {
  spaceLetterId: string;
  reservation?: SpaceReservationMetadataPresentation | null;
};

function isExactReservationForSlot(
  reservation: SpaceReservationMetadataPresentation | null | undefined,
  slot: SpaceRoundSlotAssignment,
  authorId: string,
  requiredStatus?: string,
): boolean {
  if (
    !reservation ||
    !reservation.resolved ||
    (requiredStatus && reservation.status !== requiredStatus) ||
    reservation.slotId !== slot.id ||
    reservation.roundId !== slot.spaceRoundId ||
    reservation.authorId !== authorId ||
    !slot.scheduledDate ||
    reservation.date !== slot.scheduledDate
  ) {
    return false;
  }
  const slotDate = parseKstDateString(slot.scheduledDate);
  return !!slotDate && reservation.scheduledAt === kstDateAt6(slotDate).toISOString();
}

/**
 * A resolved CENTER reservation owns only the immutable slot identity it names.
 * Legacy unscheduled letters retain their explicit round assignment; unresolved
 * reservation metadata deliberately never falls back to mutable letter fields.
 */
export function getSpaceLetterPresentationRoundId(
  letter: SpaceRoundCenterLetterMatch,
  firstRoundId: string | null,
): string | null {
  if (letter.letterType === "CENTER") {
    if (letter.reservation !== undefined && letter.reservation !== null) {
      return letter.reservation.resolved ? letter.reservation.roundId : null;
    }
    // No current reservation, but a scheduling history: this letter was
    // written and then had its only send cancelled. It must not fall back
    // to `spaceRoundId` (that fallback exists for true-legacy letters with
    // no scheduling history at all) or it would render as a normal,
    // already-sent round letter — the exact stale state this distinction
    // exists to prevent. Callers keep it out of round grouping/counts and
    // present it separately via `findWithdrawnCenterLetterForSlot`.
    if (letter.everScheduled) return null;
  }
  if (letter.spaceRoundId) return letter.spaceRoundId;
  return letter.letterType === "OPENING" && !letter.reservation ? firstRoundId : null;
}

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

    const slot = reservation.reservation?.slotId
      ? slotsById.get(reservation.reservation.slotId)
      : undefined;
    if (
      !slot ||
      !isExactReservationForSlot(reservation.reservation, slot, letter.authorId, "PENDING") ||
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

/** Whether a CENTER letter should hide this exact slot in active/completed views. */
export function doesSpaceLetterOccupyRoundSlot<
  TLetter extends SpaceRoundCenterLetterMatch,
  TSlot extends SpaceRoundSlotAssignment,
>(letter: TLetter, slot: TSlot): boolean {
  if (letter.letterType !== "CENTER" || letter.authorId !== slot.assignedUserId) return false;
  if (letter.reservation !== undefined && letter.reservation !== null) {
    return isExactReservationForSlot(letter.reservation, slot, letter.authorId) &&
      (letter.reservation.status === "PENDING" || letter.reservation.status === "SENT");
  }
  return letter.spaceRoundId === slot.spaceRoundId;
}

/**
 * Finds the CENTER letter (if any) that was written for this exact slot and
 * then had its only reservation cancelled. `reservation` is deliberately
 * null once cancelled (see `doesSpaceLetterOccupyRoundSlot`), so this slot
 * would otherwise look identical to one nobody has ever touched. `everScheduled`
 * + `lastReservation` (which keeps the cancelled send's slot/round/date
 * identity even though it's no longer "current") let presentation code tell
 * the two apart without resurrecting the cancelled send as active.
 *
 * Deliberately does NOT match a letter with a live (non-null) `reservation`:
 * that letter is either occupying the slot already (via
 * `doesSpaceLetterOccupyRoundSlot`) or reserved for a different slot/round.
 */
export function findWithdrawnCenterLetterForSlot<
  TLetter extends SpaceRoundCenterLetterMatch,
  TSlot extends SpaceRoundSlotAssignment,
>(letters: readonly TLetter[], slot: TSlot): TLetter | null {
  for (const letter of letters) {
    if (
      letter.letterType !== "CENTER" ||
      letter.authorId !== slot.assignedUserId ||
      letter.reservation != null ||
      !letter.everScheduled ||
      !letter.lastReservation
    ) {
      continue;
    }
    if (isExactReservationForSlot(letter.lastReservation, slot, letter.authorId)) {
      return letter;
    }
  }
  return null;
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
