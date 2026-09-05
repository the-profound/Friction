import { describe, expect, it } from "vitest";
import { getThoughtCreateRetryAction } from "./thoughtCreateIdempotency";

describe("thought create retry generation ordering", () => {
  it("keeps the newer payload when the stale request arrives last", () => {
    expect(getThoughtCreateRetryAction({
      existingGeneration: 2,
      incomingGeneration: 1,
      contentMatches: false,
    })).toBe("return-existing");
  });

  it("updates when the newer retry arrives after the original request", () => {
    expect(getThoughtCreateRetryAction({
      existingGeneration: 1,
      incomingGeneration: 2,
      contentMatches: false,
    })).toBe("update");
  });

  it("rejects different payloads that claim the same generation", () => {
    expect(getThoughtCreateRetryAction({
      existingGeneration: 1,
      incomingGeneration: 1,
      contentMatches: false,
    })).toBe("conflict");
  });
});