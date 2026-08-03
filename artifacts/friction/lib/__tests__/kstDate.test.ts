import { describe, it, expect } from "vitest";
import {
  kstToday,
  kstTomorrow,
  minOpeningSendDate,
  kstDateAt6,
  toKstCalendarDate,
} from "../kstDate";

// 헬퍼들은 "로컬 자정 Date"를 달력 날짜로 반환한다.
// 테스트 환경의 시간대와 무관하게, 반환된 Date의 로컬 Y/M/D 필드가
// KST 달력 날짜와 일치하는지 확인한다.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe("kstToday / kstTomorrow", () => {
  it("KST 자정 직후(UTC 전날 15:00)에는 KST 새 날짜를 반환한다", () => {
    // 2026-04-27 00:30 KST = 2026-04-26 15:30 UTC
    const now = new Date("2026-04-26T15:30:00Z");
    expect(ymd(kstToday(now))).toBe("2026-04-27");
    expect(ymd(kstTomorrow(now))).toBe("2026-04-28");
  });

  it("KST 23:59에는 아직 당일이다", () => {
    // 2026-04-27 23:59 KST = 2026-04-27 14:59 UTC
    const now = new Date("2026-04-27T14:59:00Z");
    expect(ymd(kstToday(now))).toBe("2026-04-27");
  });
});

describe("minOpeningSendDate — KST 06:00 컷오프", () => {
  it("KST 05:59이면 오늘부터 발송 가능", () => {
    // 2026-04-27 05:59 KST = 2026-04-26 20:59 UTC
    const now = new Date("2026-04-26T20:59:00Z");
    expect(ymd(minOpeningSendDate(now))).toBe("2026-04-27");
  });

  it("KST 06:00 정각이면 내일부터 발송 가능", () => {
    // 2026-04-27 06:00 KST = 2026-04-26 21:00 UTC
    const now = new Date("2026-04-26T21:00:00Z");
    expect(ymd(minOpeningSendDate(now))).toBe("2026-04-28");
  });

  it("KST 저녁(18:00)에도 내일부터 발송 가능", () => {
    // 2026-04-27 18:00 KST = 2026-04-27 09:00 UTC
    const now = new Date("2026-04-27T09:00:00Z");
    expect(ymd(minOpeningSendDate(now))).toBe("2026-04-28");
  });
});

describe("kstDateAt6 — 달력 날짜의 KST 06:00 절대 시각", () => {
  it("항상 KST 06:00(= UTC 전날 21:00) instant를 만든다", () => {
    const calendarDate = new Date(2026, 3, 27); // 로컬 2026-04-27 자정
    expect(kstDateAt6(calendarDate).toISOString()).toBe("2026-04-26T21:00:00.000Z");
  });
});

describe("toKstCalendarDate — instant를 KST 달력 날짜로", () => {
  it("KST 06:00 발송 instant는 해당 KST 날짜로 표시된다", () => {
    // 2026-04-27 06:00 KST = 2026-04-26 21:00 UTC
    expect(ymd(toKstCalendarDate(new Date("2026-04-26T21:00:00Z")))).toBe("2026-04-27");
  });

  it("kstDateAt6와 왕복이 일치한다", () => {
    const cal = new Date(2026, 11, 31);
    expect(ymd(toKstCalendarDate(kstDateAt6(cal)))).toBe("2026-12-31");
  });
});
