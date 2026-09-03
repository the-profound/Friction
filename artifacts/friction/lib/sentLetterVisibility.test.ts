import { describe, expect, it } from "vitest";

import {
  isSpaceSendRecord,
  shouldDisplaySentLetter,
} from "./sentLetterVisibility";

describe("sent letter visibility", () => {
  it.each(["person", "reply"] as const)(
    "keeps %s sends visible without a space-letter row",
    (targetType) => {
      expect(isSpaceSendRecord({ targetType, spaceId: null })).toBe(false);
      expect(shouldDisplaySentLetter(true, undefined)).toBe(true);
    },
  );

  it("shows only PUBLIC sends when an article was sent exclusively to spaces", () => {
    expect(isSpaceSendRecord({ targetType: "space", spaceId: "space-1" })).toBe(true);
    expect(shouldDisplaySentLetter(false, "PUBLIC")).toBe(true);
    expect(shouldDisplaySentLetter(false, "RECIPIENT_ONLY")).toBe(false);
    expect(shouldDisplaySentLetter(false, undefined)).toBe(false);
  });

  it("keeps a person/reply copy visible even when the same article also has a private space send", () => {
    expect(shouldDisplaySentLetter(true, "RECIPIENT_ONLY")).toBe(true);
  });
});