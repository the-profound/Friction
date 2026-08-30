import { afterEach, describe, expect, it, vi } from "vitest";

import { generateRandomPreliminaryThoughtQuestion } from "./generate-random-preliminary-thought-question";

describe("generateRandomPreliminaryThoughtQuestion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("avoids titles that are already active in the queue", () => {
    vi.spyOn(Math, "random").mockReturnValue(0);

    const first = generateRandomPreliminaryThoughtQuestion();
    expect(first).not.toBeNull();
    if (!first) throw new Error("Expected a random question");

    const second = generateRandomPreliminaryThoughtQuestion(new Set([first.title]));
    expect(second).not.toBeNull();
    expect(second?.title).not.toBe(first.title);
  });
});