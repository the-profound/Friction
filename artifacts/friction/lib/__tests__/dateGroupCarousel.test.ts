import { describe, expect, it } from "vitest";
import {
  clampCarouselIndex,
  getCarouselNextIndex,
  getDateGroupCarouselHeight,
  preserveCarouselIndex,
} from "../dateGroupCarousel";
import {
  findDateGroupAtOffset,
  getDateGroupPageDecision,
  getDateGroupPageIndex,
  preserveDateGroupAnchor,
  resolveDateGroupLayouts,
  shouldApplyDateGroupMeasurement,
  type DateGroupLayout,
} from "../dateGroupVerticalSnap";

describe("shared date-group carousel geometry", () => {
  it("clamps every carousel index at both boundaries", () => {
    expect(clampCarouselIndex(-1, 3)).toBe(0);
    expect(clampCarouselIndex(5, 3)).toBe(2);
    expect(clampCarouselIndex(1, 0)).toBe(0);
  });

  it("uses the same threshold and fling direction rules in both screens", () => {
    expect(getCarouselNextIndex(1, 3, -48, 0, 48, 0.5)).toBe(2);
    expect(getCarouselNextIndex(1, 3, 47, 0, 48, 0.5)).toBe(1);
    expect(getCarouselNextIndex(0, 3, -2, -0.6, 48, 0.5)).toBe(1);
    expect(getCarouselNextIndex(0, 3, 80, 0, 48, 0.5)).toBe(0);
  });

  it("reserves stable header, shadow, action, dot, and group spacing", () => {
    expect(getDateGroupCarouselHeight(480, 0, 100)).toBe(580);
    expect(getDateGroupCarouselHeight(480, 56, 100)).toBe(636);
  });

  it("keeps the selected question through FIFO refreshes and falls back to the nearest slot", () => {
    expect(preserveCarouselIndex("question-b", 1, ["question-b", "question-c", "question-d"]))
      .toBe(0);
    expect(preserveCarouselIndex("question-b", 1, ["question-c", "question-d"]))
      .toBe(1);
    expect(preserveCarouselIndex("question-c", 2, ["question-c"]))
      .toBe(0);
  });
});

describe("vertical date-header snapping", () => {
  const layouts = [
    { dateKey: "2026-08-29", offset: 0, height: 520 },
    { dateKey: "2026-08-28", offset: 520, height: 760 },
    { dateKey: "2026-08-27", offset: 1280, height: 500 },
  ];

  it("does not guess an unmeasured anchor", () => {
    expect(findDateGroupAtOffset(100, [])).toBeNull();
    expect(getDateGroupPageDecision(
      "2026-08-29",
      ["2026-08-29"],
      [],
      -100,
      -1,
      48,
      0.5,
    ).targetOffset).toBeNull();
  });

  it("uses measured date-header positions instead of inferred row offsets", () => {
    const heights = new Map([
      ["2025-03-13", 580],
      ["2025-03-12", 640],
      ["2025-03-11", 580],
    ]);
    const measured = new Map<string, DateGroupLayout>([
      ["2025-03-12", {
        dateKey: "2025-03-12",
        offset: 612,
        height: 640,
      }],
    ]);

    expect(resolveDateGroupLayouts(
      ["2025-03-13", "2025-03-12", "2025-03-11"],
      heights,
      measured,
    )).toEqual([
      { dateKey: "2025-03-13", offset: 0, height: 580 },
      { dateKey: "2025-03-12", offset: 612, height: 640 },
      { dateKey: "2025-03-11", offset: 1252, height: 580 },
    ]);
  });

  it("rejects measurements that started before a data or layout generation change", () => {
    expect(shouldApplyDateGroupMeasurement(4, 5, true, 640)).toBe(false);
    expect(shouldApplyDateGroupMeasurement(5, 5, false, 640)).toBe(false);
    expect(shouldApplyDateGroupMeasurement(5, 5, true, 0)).toBe(false);
    expect(shouldApplyDateGroupMeasurement(5, 5, true, 640)).toBe(true);
  });

  it("keeps a date key across refreshes and chooses its nearest slot if removed", () => {
    const previous = ["queue", "2026-08-29", "2026-08-28"];
    expect(preserveDateGroupAnchor("2026-08-29", previous, previous)).toBe("2026-08-29");
    expect(preserveDateGroupAnchor("2026-08-29", previous, ["queue", "2026-08-28"]))
      .toBe("2026-08-28");
    expect(preserveDateGroupAnchor("2026-08-28", previous, ["queue", "2026-08-29"]))
      .toBe("2026-08-29");
  });

  it("moves exactly one date group from the gesture-start key", () => {
    const keys = layouts.map((layout) => layout.dateKey);
    expect(getDateGroupPageIndex(keys[1], keys, -5000, -8, 48, 0.5)).toBe(2);
    expect(getDateGroupPageIndex(keys[1], keys, 5000, 8, 48, 0.5)).toBe(0);
    expect(getDateGroupPageIndex(keys[1], keys, -20, 0, 48, 0.5)).toBe(1);
    expect(getDateGroupPageIndex(keys[0], keys, 5000, 8, 48, 0.5)).toBe(0);
    expect(getDateGroupPageIndex(keys[2], keys, -5000, -8, 48, 0.5)).toBe(2);
  });

  it("uses inclusive distance and strict fling thresholds", () => {
    const keys = layouts.map((layout) => layout.dateKey);
    expect(getDateGroupPageIndex(keys[1], keys, -47, 0, 48, 0.5)).toBe(1);
    expect(getDateGroupPageIndex(keys[1], keys, -48, 0, 48, 0.5)).toBe(2);
    expect(getDateGroupPageIndex(keys[1], keys, -2, -0.5, 48, 0.5)).toBe(1);
    expect(getDateGroupPageIndex(keys[1], keys, -2, -0.51, 48, 0.5)).toBe(2);
  });

  it("pages by headers even when the current group is taller than the viewport", () => {
    const tallLayouts = [
      { dateKey: "a", offset: 0, height: 2000 },
      { dateKey: "b", offset: 2000, height: 2200 },
      { dateKey: "c", offset: 4200, height: 500 },
    ];
    expect(getDateGroupPageDecision(
      "a",
      tallLayouts.map((layout) => layout.dateKey),
      tallLayouts,
      -60,
      0,
      48,
      0.5,
    )).toMatchObject({ dateKey: "b", targetOffset: 2000 });
  });

  it("treats consecutive swipes as separate one-step decisions", () => {
    const keys = layouts.map((layout) => layout.dateKey);
    const firstIndex = getDateGroupPageIndex(keys[0], keys, -200, -2, 48, 0.5);
    const secondIndex = getDateGroupPageIndex(keys[firstIndex], keys, -200, -2, 48, 0.5);
    expect(firstIndex).toBe(1);
    expect(secondIndex).toBe(2);
  });

  it("uses the current date header for weak gestures and the adjacent header for swipes", () => {
    expect(getDateGroupPageDecision(
      "2026-08-28",
      layouts.map((layout) => layout.dateKey),
      layouts,
      -60,
      0,
      48,
      0.5,
    )).toMatchObject({ dateKey: "2026-08-27", targetOffset: 1280 });
    expect(getDateGroupPageDecision(
      "2026-08-28",
      layouts.map((layout) => layout.dateKey),
      layouts,
      12,
      0,
      48,
      0.5,
    )).toMatchObject({ dateKey: "2026-08-28", targetOffset: 520 });
  });
});