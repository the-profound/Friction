import { describe, expect, it } from "vitest";
import {
  clampCarouselIndex,
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
});