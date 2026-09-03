import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { classifyPreviewPagerGesture } from "./gesturePolicy";

const source = readFileSync(join(__dirname, "PreviewPager.tsx"), "utf8");

describe("PreviewPager reader parity", () => {
  it("keeps three keyed page instances across role changes", () => {
    expect(source).toContain('{ pageIdx: current + 1, role: "next" as const }');
    expect(source).toContain('{ pageIdx: current, role: "current" as const }');
    expect(source).toContain('{ pageIdx: current - 1, role: "prev" as const }');
    expect(source).toContain('key={`page-${slot.pageIdx}`}');
  });

  it("uses the reader distance, velocity, spring, and completion timing", () => {
    expect(source).toContain("Math.abs(dx) > width * 0.22");
    expect(source).toContain("Math.abs(event.velocityX) > 450");
    expect(source).toContain("damping: 18, stiffness: 280, mass: 0.8");
    expect(source).toContain("duration: 240");
    expect(source).toContain("Easing.bezier(0.25, 0.46, 0.45, 0.94)");
  });

  it("rejects vertical gestures and clamps both page boundaries", () => {
    expect(source).toContain("-PREVIEW_PAGER_HORIZONTAL_ACTIVATION");
    expect(source).toContain("-PREVIEW_PAGER_VERTICAL_FAILURE");
    expect(source).toContain("activeSwipeRef.current !== activeDirection");
    expect(source).toContain("Math.abs(event.translationY) > Math.abs(dx) * 1.8");
    expect(source).toContain("current < total - 1");
    expect(source).toContain("current > 0");
    expect(source).toContain("Math.max(0, Math.min(pageCountRef.current - 1");
    expect(source).toContain("direction === -1 ? 1 : -1");
  });

  it("fails vertical-biased motion before horizontal jitter can activate", () => {
    expect(classifyPreviewPagerGesture(8, 13)).toBe("undetermined");
    expect(classifyPreviewPagerGesture(9, 16)).toBe("failed");
    expect(classifyPreviewPagerGesture(21, 10)).toBe("active");
    expect(classifyPreviewPagerGesture(-21, -10)).toBe("active");
  });

  it("invalidates an in-flight completion when pages or layout change", () => {
    expect(source).toContain("generationRef.current += 1");
    expect(source).toContain("generation !== generationRef.current");
    expect(source).toContain("sourcePage !== pageIndexRef.current");
  });

  it("fits short viewports and reserves touch gestures on web", () => {
    expect(source).toContain("Math.min(availableSize.height, 480)");
    expect(source).toContain("Math.min(availableSize.width, maxHeight * ReaderTokens.aspectRatio)");
    expect(source).toContain('{ touchAction: "none" }');
    expect(source).toContain('Platform.OS === "android"');
    expect(source).toContain("{ left: -24, right: -24 }");
  });
});