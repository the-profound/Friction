import { describe, expect, it } from "vitest";
import {
  DATE_GROUP_SEARCH_GESTURE_THRESHOLD,
  isDateGroupSearchBoundaryGesture,
  isListSearchBoundaryGesture,
} from "../dateGroupVerticalSnap";

describe("date group search boundary gesture", () => {
  const keys = ["today", "yesterday"];

  it("accepts only a short upward gesture at the first group", () => {
    expect(isDateGroupSearchBoundaryGesture("today", keys, -DATE_GROUP_SEARCH_GESTURE_THRESHOLD, 48)).toBe(true);
    expect(isDateGroupSearchBoundaryGesture("today", keys, -47, 48)).toBe(true);
    expect(isDateGroupSearchBoundaryGesture("today", keys, -48, 48)).toBe(false);
    expect(isDateGroupSearchBoundaryGesture("today", keys, 30, 48)).toBe(false);
    expect(isDateGroupSearchBoundaryGesture("today", keys, -30, 48, 18, -0.8, 0.5)).toBe(false);
  });

  it("does not open search from later date groups", () => {
    expect(isDateGroupSearchBoundaryGesture("yesterday", keys, -30, 48)).toBe(false);
  });

  it("uses the list gesture's starting offset, not its scrolled end offset", () => {
    expect(isListSearchBoundaryGesture(0, -30, 48, 0.2, 0.5)).toBe(true);
    expect(isListSearchBoundaryGesture(20, -30, 48, 0.2, 0.5)).toBe(false);
    expect(isListSearchBoundaryGesture(0, -30, 48, 0.8, 0.5)).toBe(false);
  });
});