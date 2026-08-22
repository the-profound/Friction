import { describe, expect, it } from "vitest";

import {
  formatPreliminaryQuestionMarkdown,
  isQuestionThoughtMarkdown,
} from "./preliminary-question-format";

describe("preliminary question format", () => {
  it("recognizes only a Q. first line as a generated question", () => {
    expect(isQuestionThoughtMarkdown("# Q. 무엇을 더 살펴볼까?")).toBe(true);
    expect(isQuestionThoughtMarkdown("Q. 무엇을 더 살펴볼까?")).toBe(true);
    expect(isQuestionThoughtMarkdown("# 오늘의 질문")).toBe(false);
    expect(isQuestionThoughtMarkdown("본문에 Q.가 등장해도 질문이 아니다")).toBe(false);
  });

  it("keeps generated questions in the required markdown shape", () => {
    expect(formatPreliminaryQuestionMarkdown("무엇을 더 살펴볼까?", "기록 속 작은 차이를 따라가 보세요."))
      .toBe("# Q. 무엇을 더 살펴볼까?\n\n기록 속 작은 차이를 따라가 보세요.");
  });
});