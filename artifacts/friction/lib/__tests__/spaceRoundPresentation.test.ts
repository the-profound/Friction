import { describe, expect, it } from "vitest";
import {
  roundStatusLabel,
  shouldDimSpaceRoundLetter,
  sortSpaceRoundsNewestFirst,
} from "../spaceRoundPresentation";

describe("space round presentation", () => {
  it("labels completed rounds as ended", () => {
    expect(roundStatusLabel("COMPLETED")).toBe("종료");
    expect(roundStatusLabel("ACTIVE")).toBe("진행 중");
    expect(roundStatusLabel("UPCOMING")).toBe("예정");
  });

  it("orders rounds from newest to oldest without mutating API data", () => {
    const rounds = [
      { id: "round-2", roundNumber: 2 },
      { id: "round-4", roundNumber: 4 },
      { id: "round-1", roundNumber: 1 },
      { id: "round-3", roundNumber: 3 },
    ];

    expect(sortSpaceRoundsNewestFirst(rounds).map((round) => round.roundNumber)).toEqual([
      4,
      3,
      2,
      1,
    ]);
    expect(rounds.map((round) => round.roundNumber)).toEqual([2, 4, 1, 3]);
  });

  it("keeps read covers vivid only in completed-round carousels", () => {
    expect(shouldDimSpaceRoundLetter("COMPLETED", true)).toBe(false);
    expect(shouldDimSpaceRoundLetter("ACTIVE", true)).toBe(true);
    expect(shouldDimSpaceRoundLetter("UPCOMING", true)).toBe(true);
    expect(shouldDimSpaceRoundLetter("ACTIVE", false)).toBe(false);
  });
});