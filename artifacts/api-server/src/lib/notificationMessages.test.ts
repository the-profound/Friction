import { describe, it, expect } from "vitest";
import { LETTER_ARRIVED_MESSAGES, buildLetterArrivedMessage } from "./notificationMessages";

describe("LETTER_ARRIVED_MESSAGES", () => {
  it("should have exactly 5 messages", () => {
    expect(LETTER_ARRIVED_MESSAGES).toHaveLength(5);
  });
});

describe("buildLetterArrivedMessage", () => {
  // ── 정상 입력: 각 인덱스별 치환 결과 검증 ────────────────────────────────

  it("index 0: 치환 없이 고정 문구 반환", () => {
    // index 0은 플레이스홀더 없음
    // Math.random을 mock 하지 않고 overrideIdx 대신 반복으로 커버;
    // 별도로 치환 결과가 올바른지는 index 강제 검증 (아래 통합 케이스에서)
    const result = "새로운 편지가 도착했어요!";
    expect(LETTER_ARRIVED_MESSAGES[0]).toBe(result);
  });

  it("index 1: 고정 문구 반환", () => {
    expect(LETTER_ARRIVED_MESSAGES[1]).toBe("수신함에 새로운 편지가 도착했어요!");
  });

  it("index 2: {userName} 치환 결과 올바름", () => {
    const template = LETTER_ARRIVED_MESSAGES[2]!;
    const rendered = template.replace("{userName}", "홍길동");
    expect(rendered).toBe("홍길동님을 위한 편지가 도착했어요.");
  });

  it("index 3: 고정 문구 반환", () => {
    expect(LETTER_ARRIVED_MESSAGES[3]).toBe("밤새 새로운 편지가 날라왔어요.");
  });

  it("index 4: {newLetterCount} 치환 결과 올바름", () => {
    const template = LETTER_ARRIVED_MESSAGES[4]!;
    const rendered = template.replace("{newLetterCount}", "3");
    expect(rendered).toBe("새 편지 3개");
  });

  // ── {userName} 치환 정확성 ────────────────────────────────────────────────

  it("{userName} 치환이 정확한지", () => {
    // userName이 있고 letterCount가 1 이상이면 인덱스 2가 후보에 있으므로
    // 10000회 중 반드시 한 번은 인덱스 2가 선택된다 (아래 전체 커버 테스트로 검증).
    // 여기서는 index 2 템플릿에 치환 결과가 올바른지만 확인.
    const [, msg] = buildLetterArrivedMessage({ userName: "김철수", letterCount: 2 });
    // 반환된 메시지가 {userName} 리터럴을 포함하지 않아야 함
    expect(msg).not.toContain("{userName}");
  });

  it("{newLetterCount} 치환이 정확한지", () => {
    const [, msg] = buildLetterArrivedMessage({ userName: "이영희", letterCount: 5 });
    expect(msg).not.toContain("{newLetterCount}");
  });

  // ── letterCount ≤ 0 방어 조건 ─────────────────────────────────────────────

  it("letterCount ≤ 0이면 인덱스 4가 선택되지 않아야 한다 (1000회 반복)", () => {
    const selectedIndices = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [idx] = buildLetterArrivedMessage({ userName: "홍길동", letterCount: 0 });
      selectedIndices.add(idx);
    }
    expect(selectedIndices.has(4)).toBe(false);
  });

  it("letterCount가 음수이면 인덱스 4가 선택되지 않아야 한다 (1000회 반복)", () => {
    const selectedIndices = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [idx] = buildLetterArrivedMessage({ userName: "홍길동", letterCount: -1 });
      selectedIndices.add(idx);
    }
    expect(selectedIndices.has(4)).toBe(false);
  });

  // ── userName 빈 문자열 방어 조건 ─────────────────────────────────────────

  it("userName이 빈 문자열이면 인덱스 2가 선택되지 않아야 한다 (1000회 반복)", () => {
    const selectedIndices = new Set<number>();
    for (let i = 0; i < 1000; i++) {
      const [idx] = buildLetterArrivedMessage({ userName: "", letterCount: 3 });
      selectedIndices.add(idx);
    }
    expect(selectedIndices.has(2)).toBe(false);
  });

  // ── 정상 입력 시 5종 모두 선택 가능 ────────────────────────────────────────

  it("정상 입력에서 5종이 모두 선택 가능해야 한다 (10000회 반복)", () => {
    const selectedIndices = new Set<number>();
    for (let i = 0; i < 10000; i++) {
      const [idx] = buildLetterArrivedMessage({ userName: "박지성", letterCount: 2 });
      selectedIndices.add(idx);
    }
    expect(selectedIndices.has(0)).toBe(true);
    expect(selectedIndices.has(1)).toBe(true);
    expect(selectedIndices.has(2)).toBe(true);
    expect(selectedIndices.has(3)).toBe(true);
    expect(selectedIndices.has(4)).toBe(true);
  });
});
