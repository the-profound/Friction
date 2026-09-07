import { describe, expect, it } from "vitest";
import { canTransitionForward, type TransitionGuardInput } from "../articleStatusCycle";

const validInput: TransitionGuardInput = {
  content: "본문",
  title: "제목",
  pages: [{ pageIndex: 0, content: "본문", charCount: 2 }],
  hasRedWarnings: false,
};

describe("canTransitionForward DIVIDING guard", () => {
  it("blocks red overflow warnings with guidance to use the scissors button", () => {
    expect(
      canTransitionForward("DIVIDING", {
        ...validInput,
        hasRedWarnings: true,
      }),
    ).toEqual({
      allowed: false,
      reason:
        "마감 단계로 넘어가기 위해서는 글을 가위 모양의 버튼을 눌러 구분선으로 분할해주세요!",
    });
  });

  it("keeps the existing title and empty-page guidance", () => {
    expect(
      canTransitionForward("DIVIDING", {
        ...validInput,
        title: " ",
        hasRedWarnings: true,
      }),
    ).toEqual({ allowed: false, reason: "제목이 비어있습니다." });

    expect(
      canTransitionForward("DIVIDING", {
        ...validInput,
        pages: [{ pageIndex: 0, content: " ", charCount: 0 }],
        hasRedWarnings: true,
      }),
    ).toEqual({
      allowed: false,
      reason: "빈 페이지가 있습니다. 내용을 채우거나 페이지를 삭제해주세요.",
    });
  });

  it("allows valid writing to move to the closing stage", () => {
    expect(canTransitionForward("DIVIDING", validInput)).toEqual({
      allowed: true,
      target: "CLOSING",
    });
  });
});