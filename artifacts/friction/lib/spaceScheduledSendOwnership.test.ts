import { describe, expect, it } from "vitest";
import { getOwnedSpaceScheduledSends } from "./spaceScheduledSendOwnership";

describe("scheduled-send client ownership guard", () => {
  const sends = [
    { id: "mine", letter: { authorId: "user-a" } },
    { id: "other", letter: { authorId: "user-b" } },
    { id: "missing-letter", letter: null },
  ];

  it("keeps only the current user's reservations", () => {
    expect(getOwnedSpaceScheduledSends(sends, "user-a").map((send) => send.id)).toEqual(["mine"]);
  });

  it("returns no reservations without a verified caller", () => {
    expect(getOwnedSpaceScheduledSends(sends, undefined)).toEqual([]);
  });
});