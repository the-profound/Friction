// 공간 카드에 노출할 "최근 발신된 편지"를 고르는 순수 로직.
//
// - 발신 예약이 아예 없었던(진짜 레거시) 편지는 작성 시각(createdAt)을 기준으로 사용한다.
// - 발신 예약이 SENT로 처리된 편지는 실제 발신 시각(reservation.sentAt, 없으면
//   reservation.scheduledAt로 폴백)을 기준으로 사용한다.
// - PENDING/CANCELLED/FAILED 상태의 편지는 아직 발신되지 않았으므로 후보에서 제외한다.
//
// `reservation`이 null이라고 해서 반드시 "한 번도 예약된 적 없는 레거시 편지"는 아니다 —
// 유일한 예약이 CANCELLED였던 편지도 서버는 현재 예약(reservation)을 null로 내려준다
// (다른 화면의 라운드 표시 로직과의 하위 호환을 위해 서버 쪽 선택 로직은 그대로 둔다).
// 이를 구분하기 위해 서버가 별도로 내려주는 `everScheduled` 플래그를 사용한다:
// reservation이 null이면서 everScheduled도 false인 경우에만 진짜 레거시로 취급한다.

export type RecentLetterCandidate = {
  createdAt: string | Date;
  articleTitle?: string | null;
  articleExcerpt?: string | null;
  everScheduled?: boolean;
  reservation?: {
    status: "PENDING" | "SENT" | "CANCELLED" | "FAILED";
    scheduledAt: string | Date;
    sentAt?: string | Date | null;
  } | null;
};

export function getEffectiveSentAtMs(
  letter: RecentLetterCandidate,
): number | null {
  if (!letter.reservation) {
    // 진짜 레거시(한 번도 예약된 적 없음)만 createdAt 기준으로 후보에 포함한다.
    // 예약이 있었지만(everScheduled) 현재 CANCELLED라 null로 내려온 경우는 제외한다.
    return letter.everScheduled ? null : new Date(letter.createdAt).getTime();
  }
  if (letter.reservation.status === "SENT") {
    const sentAt = letter.reservation.sentAt ?? letter.reservation.scheduledAt;
    return new Date(sentAt).getTime();
  }
  return null;
}

export function sortRecentLetters<T extends RecentLetterCandidate>(
  letters: T[],
): T[] {
  return letters
    .filter((letter) => letter.articleTitle || letter.articleExcerpt)
    .map((letter) => ({ letter, sentAtMs: getEffectiveSentAtMs(letter) }))
    .filter(
      (entry): entry is { letter: T; sentAtMs: number } =>
        entry.sentAtMs !== null,
    )
    .sort((a, b) => b.sentAtMs - a.sentAtMs)
    .slice(0, 3)
    .map((entry) => entry.letter);
}
