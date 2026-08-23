import { describe, expect, it } from "vitest";
import {
  buildDateSnapOffsets,
  clampCarouselIndex,
  findNearestDateSnapOffset,
  getCarouselNextIndex,
} from "../dateGroupCarousel";

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

  it("builds snap points from measured date-header positions, not group heights", () => {
    const offsets = buildDateSnapOffsets(
      ["2026-04-03", "2026-04-02", "2026-04-01"],
      new Map([
        ["2026-04-03", 0],
        ["2026-04-02", 388],
        ["2026-04-01", 913],
      ]),
    );

    expect(offsets).toEqual([0, 388, 913]);
    expect(findNearestDateSnapOffset(540, offsets)).toBe(388);
    expect(findNearestDateSnapOffset(800, offsets)).toBe(913);
  });

  it("keeps only current date keys after a dynamic group-height refresh", () => {
    const offsets = buildDateSnapOffsets(
      ["today", "yesterday"],
      new Map([
        ["today", 0],
        ["yesterday", 521],
        ["removed-date", 812],
      ]),
    );

    expect(offsets).toEqual([0, 521]);
  });
});