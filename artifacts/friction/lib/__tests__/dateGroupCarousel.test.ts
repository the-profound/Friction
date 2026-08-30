import { describe, expect, it } from "vitest";
import {
  clampCarouselIndex,
  getCarouselNextIndex,
  getDateGroupCarouselHeight,
} from "../dateGroupCarousel";
import {
  findDateGroupAtOffset,
  getDateGroupSnapTarget,
  preserveDateGroupAnchor,
  resolveDateGroupLayouts,
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
});

describe("vertical date-header snapping", () => {
  const layouts = [
    { dateKey: "2026-08-29", offset: 0, height: 520 },
    { dateKey: "2026-08-28", offset: 520, height: 760 },
    { dateKey: "2026-08-27", offset: 1280, height: 500 },
  ];

  it("snaps a fitting group to its date header", () => {
    expect(getDateGroupSnapTarget(580, 800, layouts)).toBe(520);
    expect(getDateGroupSnapTarget(1320, 600, layouts)).toBe(1280);
    expect(getDateGroupSnapTarget(400, 800, layouts)).toBe(520);
  });

  it("captures an oversized group at its header and at its end", () => {
    // The 2026-08-28 group is 760 tall in a 640 viewport: header 520, end 640.
    expect(getDateGroupSnapTarget(530, 640, layouts)).toBe(520);
    expect(getDateGroupSnapTarget(632, 640, layouts)).toBe(640);
    // Its midpoint stays free so the user can read across the group.
    expect(getDateGroupSnapTarget(580, 640, layouts)).toBeNull();
  });

  it("leaves the interior of a very tall group freely scrollable", () => {
    const tall = [{ dateKey: "2026-08-28", offset: 0, height: 2000 }];
    expect(getDateGroupSnapTarget(0, 600, tall)).toBe(0);
    expect(getDateGroupSnapTarget(700, 600, tall)).toBeNull();
    expect(getDateGroupSnapTarget(1400, 600, tall)).toBe(1400);
  });

  it("never overlaps the two capture zones of a real record group", () => {
    // A letter record group (fixed 5:8 card plus its action row) in a viewport
    // that already excludes the navbar: it overflows, but only modestly.
    const letterGroup = [{ dateKey: "2026-08-28", offset: 0, height: 636 }];
    expect(getDateGroupSnapTarget(0, 400, letterGroup)).toBe(0);
    expect(getDateGroupSnapTarget(118, 400, letterGroup)).toBeNull();
    expect(getDateGroupSnapTarget(236, 400, letterGroup)).toBe(236);

    // Even with only 36px of overflow the midpoint stays free, so the capture
    // zones never meet regardless of how far a group exceeds the viewport.
    const barelyOversized = [{ dateKey: "2026-08-28", offset: 0, height: 636 }];
    expect(getDateGroupSnapTarget(10, 600, barelyOversized)).toBe(0);
    expect(getDateGroupSnapTarget(18, 600, barelyOversized)).toBeNull();
    expect(getDateGroupSnapTarget(30, 600, barelyOversized)).toBe(36);
  });

  it("can snap forward out of an oversized group to a fitting neighbor", () => {
    expect(getDateGroupSnapTarget(1100, 640, layouts)).toBe(1280);
  });

  it("does not guess an unmeasured anchor", () => {
    expect(findDateGroupAtOffset(100, [])).toBeNull();
    expect(getDateGroupSnapTarget(100, 700, [])).toBeNull();
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

  it("keeps a date key across refreshes and chooses its nearest slot if removed", () => {
    const previous = ["queue", "2026-08-29", "2026-08-28"];
    expect(preserveDateGroupAnchor("2026-08-29", previous, previous)).toBe("2026-08-29");
    expect(preserveDateGroupAnchor("2026-08-29", previous, ["queue", "2026-08-28"]))
      .toBe("2026-08-28");
    expect(preserveDateGroupAnchor("2026-08-28", previous, ["queue", "2026-08-29"]))
      .toBe("2026-08-29");
  });
});