import { describe, expect, it } from "vitest";
import {
  ANONYMOUS_PARTICIPANT_NAME,
  getAnonymousDisplayName,
  parseAnonymousSpaceNickname,
} from "./anonymousSpaceIdentity";

describe("anonymous space identity", () => {
  it("hides a selected nickname while the anonymous space is recruiting", () => {
    expect(getAnonymousDisplayName(
      { isAnonymous: true, status: "RECRUITING" },
      "달빛",
    )).toBe(ANONYMOUS_PARTICIPANT_NAME);
  });

  it.each(["ACTIVE", "ARCHIVED"] as const)(
    "uses the room nickname after the space is %s",
    (status) => {
      expect(getAnonymousDisplayName(
        { isAnonymous: true, status },
        "달빛",
      )).toBe("달빛");
    },
  );

  it("keeps legacy anonymous rows safe when no room nickname exists", () => {
    expect(getAnonymousDisplayName(
      { isAnonymous: true, status: "ACTIVE" },
      null,
    )).toBe(ANONYMOUS_PARTICIPANT_NAME);
  });

  it("normalizes outer whitespace and rejects missing or oversized nicknames", () => {
    expect(parseAnonymousSpaceNickname("  달빛  ")).toBe("달빛");
    expect(parseAnonymousSpaceNickname("   ")).toBeNull();
    expect(parseAnonymousSpaceNickname("가".repeat(21))).toBeNull();
  });
});