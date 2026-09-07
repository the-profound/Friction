/**
 * Letter-arrived notification messages and utilities.
 *
 * 5개 문구 중 방어 조건 적용 후 균등 확률로 선택하고,
 * {userName} / {newLetterCount} 플레이스홀더를 실제 값으로 치환한다.
 */

export const SEND_HOUR_KST = 6; // 06:00 KST
export const WINDOW_HOURS = 24; // 집계 윈도우 (시간)

/** 알림 문구 5종 (인덱스 0~4 = 1~5번 문구) */
export const LETTER_ARRIVED_MESSAGES: string[] = [
  "새로운 편지가 도착했어요!",
  "수신함에 새로운 편지가 도착했어요!",
  "{userName}님을 위한 편지가 도착했어요.",
  "밤새 새로운 편지가 날아왔어요.",
  "새 편지 {newLetterCount}개",
];

/**
 * 후보 풀에서 인덱스를 선택하고 치환한 메시지를 반환한다.
 * @returns [selectedIndex, renderedMessage]
 */
function selectTemplate(
  pool: number[],
  userName: string,
  letterCount: number,
  overrideIdx?: number,
): [number, string] {
  const idx =
    overrideIdx !== undefined ? overrideIdx : pool[Math.floor(Math.random() * pool.length)]!;
  const template = LETTER_ARRIVED_MESSAGES[idx]!;
  const message = template
    .replace("{userName}", userName)
    .replace("{newLetterCount}", String(letterCount));
  return [idx, message];
}

/**
 * 방어 조건 적용 후 랜덤 문구 선택 → 플레이스홀더 치환.
 *
 * 방어 조건:
 *  - letterCount ≤ 0 → 인덱스 4 ("새 편지 {newLetterCount}개") 제외
 *  - userName이 빈 문자열 → 인덱스 2 ("{userName}님을 위한...") 제외
 *
 * @returns [selectedIndex, renderedMessage]
 */
export function buildLetterArrivedMessage({
  userName,
  letterCount,
}: {
  userName: string;
  letterCount: number;
}): [number, string] {
  let pool = [0, 1, 2, 3, 4];

  if (letterCount <= 0) {
    pool = pool.filter((i) => i !== 4);
  }
  if (userName === "") {
    pool = pool.filter((i) => i !== 2);
  }

  return selectTemplate(pool, userName, letterCount);
}
