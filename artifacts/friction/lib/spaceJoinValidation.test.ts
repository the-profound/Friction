import { describe, expect, it } from "vitest";
import {
  SPACE_NICKNAME_MAX_LENGTH,
  validateSpaceNickname,
} from "./spaceJoinValidation";

describe("space nickname validation", () => {
  it("rejects empty and whitespace-only nicknames", () => {
    expect(validateSpaceNickname("")).toBe("공간 닉네임을 입력해주세요.");
    expect(validateSpaceNickname("   \n\t")).toBe(
      "공간 닉네임을 입력해주세요.",
    );
  });

  it("allows nicknames up to the maximum length", () => {
    expect(validateSpaceNickname("달빛")).toBeNull();
    expect(
      validateSpaceNickname("가".repeat(SPACE_NICKNAME_MAX_LENGTH)),
    ).toBeNull();
  });

  it("rejects nicknames over the maximum length", () => {
    expect(
      validateSpaceNickname("가".repeat(SPACE_NICKNAME_MAX_LENGTH + 1)),
    ).toBe(
      `공간 닉네임은 ${SPACE_NICKNAME_MAX_LENGTH}자까지 입력할 수 있어요.`,
    );
  });
});
