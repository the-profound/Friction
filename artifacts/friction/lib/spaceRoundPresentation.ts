import { kstDateAt6, toKstCalendarDate } from "./kstDate";

export type SpaceRoundPresentation = {
  roundNumber: number;
};

type DatedSpaceRoundPresentation = SpaceRoundPresentation & {
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