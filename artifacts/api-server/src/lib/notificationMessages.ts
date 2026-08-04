/**
 * Letter-arrived notification messages and utilities.
 *
 * 5개 문구 중 1개를 균등 확률로 선택하고,
 * {userName} / {newLetterCount} 플레이스홀더를 실제 값으로 치환한다.
 */

export const SEND_HOUR_KST = 6; // 06:00 KST
export const WINDOW_HOURS = 24; // 집계 윈도우 (시간)

/** 알림 문구 5종 */
export const LETTER_ARRIVED_MESSAGES: string[] = [
  "{userName}님, 어제 새 편지가 {newLetterCount}통 도착했어요. 조용히 열어보세요.",
  "받은 편지함에 {newLetterCount}통이 기다리고 있어요, {userName}님.",
  "{userName}님께 어제 {newLetterCount}통의 편지가 왔어요.",
  "누군가 {userName}님에게 {newLetterCount}통의 편지를 보냈어요.",
  "어제 도착한 편지 {newLetterCount}통, {userName}님이 읽어주길 기다리고 있어요.",
];

/**
 * 랜덤 문구 선택 후 플레이스홀더 치환.
 * @returns [selectedIndex, renderedMessage]
 */
export function pickLetterArrivedMessage(
  userName: string,
  newLetterCount: number,
): [number, string] {
  const idx = Math.floor(Math.random() * LETTER_ARRIVED_MESSAGES.length);
  const template = LETTER_ARRIVED_MESSAGES[idx]!;
  const message = template
    .replace("{userName}", userName)
    .replace("{newLetterCount}", String(newLetterCount));
  return [idx, message];
}
