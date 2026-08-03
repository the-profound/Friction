/**
 * KST(Asia/Seoul) 기준 날짜 계산 헬퍼.
 *
 * 앱의 달력 UI(CalendarGrid 등)는 "로컬 자정 Date"를 달력 날짜로 사용한다.
 * 이 모듈은 기기 시간대와 무관하게 KST 달력 날짜를 그 로컬-자정 표현으로
 * 변환하고, "KST 06:00"이라는 절대 시각(instant)을 만들어 서버 payload에
 * 일관되게 넣을 수 있게 한다.
 */

export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * KST 기준 "지금"의 벽시계 시각을 로컬 getter로 읽을 수 있는 Date를 반환한다.
 * (getFullYear/getMonth/getDate/getHours가 KST 벽시계 값을 반환)
 */
export function getKstNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + now.getTimezoneOffset() * 60 * 1000 + KST_OFFSET_MS);
}

/** KST 기준 오늘 날짜 (로컬 자정 Date — 달력 셀 비교용) */
export function kstToday(now: Date = new Date()): Date {
  const k = getKstNow(now);
  return new Date(k.getFullYear(), k.getMonth(), k.getDate());
}

/** KST 기준 내일 날짜 (로컬 자정 Date) */
export function kstTomorrow(now: Date = new Date()): Date {
  const t = kstToday(now);
  t.setDate(t.getDate() + 1);
  return t;
}

/**
 * 여는 편지 최소 발송 가능일: KST 06:00 이전이면 오늘, 이후면 내일.
 * (로컬 자정 Date 반환)
 */
export function minOpeningSendDate(now: Date = new Date()): Date {
  const kstNow = getKstNow(now);
  const min = kstToday(now);
  if (kstNow.getHours() >= 6) min.setDate(min.getDate() + 1);
  return min;
}

/**
 * 달력 날짜(로컬 Y/M/D 필드 기준)의 "KST 06:00" 절대 시각을 반환한다.
 * 기기 시간대와 무관하게 항상 한국 시간 오전 6시를 가리키는 instant.
 */
export function kstDateAt6(calendarDate: Date): Date {
  return new Date(
    Date.UTC(
      calendarDate.getFullYear(),
      calendarDate.getMonth(),
      calendarDate.getDate(),
      6,
      0,
      0,
      0,
    ) - KST_OFFSET_MS,
  );
}

/** 절대 시각(instant)을 KST 달력 날짜(로컬 자정 Date)로 변환 — 표시용 */
export function toKstCalendarDate(instant: Date): Date {
  const k = getKstNow(instant);
  return new Date(k.getFullYear(), k.getMonth(), k.getDate());
}
