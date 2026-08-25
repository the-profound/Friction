import { describe, expect, it } from "vitest";
import {
  parseSpaceCreationIdentity,
  parseSpaceCreationKey,
} from "./spaceCreationInput";

describe("space creation identity validation", () => {
  it("accepts a real-name space only with an explicit false and no nickname", () => {
    expect(parseSpaceCreationIdentity({ isAnonymous: false })).toEqual({
      success: true,
      isAnonymous: false,
      anonymousNickname: null,
    });
    expect(parseSpaceCreationIdentity({ isAnonymous: false, spaceNickname: "달빛" })).toEqual({
      success: false,
      error: "실명 공간에는 공간 닉네임을 입력하지 않습니다.",
    });
  });

  it("requires a trimmed 1–20 character nickname for anonymous spaces", () => {
    expect(parseSpaceCreationIdentity({ isAnonymous: true, spaceNickname: "  달빛  " })).toEqual({
      success: true,
      isAnonymous: true,
      anonymousNickname: "달빛",
    });
    expect(parseSpaceCreationIdentity({ isAnonymous: true, spaceNickname: " " })).toMatchObject({
      success: false,
    });
    expect(
      parseSpaceCreationIdentity({ isAnonymous: true, spaceNickname: "가".repeat(21) }),
    ).toMatchObject({ success: false });
  });

  it("rejects missing or non-boolean anonymity state", () => {
    expect(parseSpaceCreationIdentity({})).toMatchObject({ success: false });
    expect(parseSpaceCreationIdentity({ isAnonymous: "false" })).toMatchObject({
      success: false,
    });
  });

  it("accepts only opaque, bounded creation idempotency keys", () => {
    expect(parseSpaceCreationKey("sc_abc123def456ghi789")).toBe("sc_abc123def456ghi789");
    expect(parseSpaceCreationKey("sc_too-short")).toBeNull();
    expect(parseSpaceCreationKey("nickname-not-a-key")).toBeNull();
  });
});