import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyPreviewPagerGesture,
  getPreviewPagerTurn,
} from "./gesturePolicy";
import { fitPreviewPagerDimensions } from "./previewGeometry";

const source = readFileSync(join(__dirname, "PreviewPager.tsx"), "utf8");
const closingSource = readFileSync(join(__dirname, "../../app/on-01c.tsx"), "utf8");
const coverPreviewSource = readFileSync(
  join(__dirname, "../CoverPreview/CoverPreview.tsx"),
  "utf8",
);

describe("PreviewPager reader parity", () => {
  it("keeps three keyed page instances across role changes", () => {
    expect(source).toContain('{ pageIdx: current + 1, role: "next" as const }');
    expect(source).toContain('{ pageIdx: current, role: "current" as const }');
    expect(source).toContain('{ pageIdx: current - 1, role: "prev" as const }');
    expect(source).toContain('key={`page-${slot.pageIdx}`}');
  });

  it("uses the reader distance, velocity, spring, and completion timing", () => {
    expect(source).toContain("getPreviewPagerTurn({");
    expect(source).toContain("velocityX: event.velocityX");
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

  it("snaps back after a short drag and commits a fast flick", () => {
    expect(getPreviewPagerTurn({
      pageIndex: 1,
      pageCount: 3,
      width: 300,
      translationX: -40,
      velocityX: -200,
    })).toBe(1);
    expect(getPreviewPagerTurn({
      pageIndex: 1,
      pageCount: 3,
      width: 300,
      translationX: -20,
      velocityX: -451,
    })).toBe(2);
    expect(getPreviewPagerTurn({
      pageIndex: 1,
      pageCount: 3,
      width: 300,
      translationX: 20,
      velocityX: 451,
    })).toBe(0);
  });

  it("moves one page from the middle and clamps the first and last pages", () => {
    expect(getPreviewPagerTurn({
      pageIndex: 1,
      pageCount: 3,
      width: 300,
      translationX: -100,
      velocityX: 0,
    })).toBe(2);
    expect(getPreviewPagerTurn({
      pageIndex: 0,
      pageCount: 3,
      width: 300,
      translationX: 100,
      velocityX: 900,
    })).toBe(0);
    expect(getPreviewPagerTurn({
      pageIndex: 2,
      pageCount: 3,
      width: 300,
      translationX: -100,
      velocityX: -900,
    })).toBe(2);
  });

  it("invalidates an in-flight completion when pages or layout change", () => {
    expect(source).toContain("generationRef.current += 1");
    expect(source).toContain("generation !== generationRef.current");
    expect(source).toContain("sourcePage !== pageIndexRef.current");
  });

  it("uses all available phone space instead of imposing the old 480px cap", () => {
    expect(fitPreviewPagerDimensions(
      { width: 342, height: 634 },
      5 / 8,
    )).toEqual({ width: 342, height: 547.2 });
    expect(fitPreviewPagerDimensions(
      { width: 327, height: 490 },
      5 / 8,
    )).toEqual({ width: 306.25, height: 490 });
    expect(fitPreviewPagerDimensions(
      { width: 382, height: 700 },
      5 / 8,
    )).toEqual({ width: 382, height: 611.2 });
    expect(source).toContain("fitPreviewPagerDimensions(availableSize, ReaderTokens.aspectRatio)");
    expect(source).not.toContain("480");
    expect(coverPreviewSource).not.toContain("maxHeight");
    expect(closingSource).not.toContain("previewVerticalOffset");
  });

  it("makes the closing cover fill the same calculated frame as body pages", () => {
    expect(closingSource).toContain(
      "<View style={[styles.coverPreviewWrapper, dimensions]}>",
    );
    expect(coverPreviewSource).toContain('width: "100%"');
    expect(coverPreviewSource).toContain('height: "100%"');
    expect(coverPreviewSource).toContain("compact && styles.containerCompact");
    expect(coverPreviewSource).toContain("width: COMPACT_PREVIEW_WIDTH");
    expect(coverPreviewSource).toContain("height: COMPACT_PREVIEW_HEIGHT");
  });

  it("returns no frame until both measured axes are usable", () => {
    expect(fitPreviewPagerDimensions({ width: 0, height: 600 }, 5 / 8))
      .toEqual({ width: 0, height: 0 });
    expect(fitPreviewPagerDimensions({ width: 360, height: 0 }, 5 / 8))
      .toEqual({ width: 0, height: 0 });
  });

  it("reserves touch gestures on web and expands the Android hit target", () => {
    expect(source).toContain('{ touchAction: "none" }');
    expect(source).toContain('Platform.OS === "android"');
    expect(source).toContain("{ left: -24, right: -24 }");
  });

  it("keeps the closing screen read-only and pager-driven", () => {
    expect(closingSource).toContain('import PreviewPager from "@/components/PreviewPager/PreviewPager";');
    expect(closingSource).toContain("<PreviewPager");
    expect(closingSource).toContain("pageCount={totalVirtualPages}");
    expect(closingSource).toContain("pageIndex={clampedPreviewPage}");
    expect(closingSource).toContain("onPageChange={setPreviewPage}");
    expect(closingSource).toContain("renderPage={(pageIndex, dimensions) =>");
    expect(closingSource).not.toContain("<TextInput");
    expect(closingSource).not.toContain("visibilityToggleBtn");
    expect(closingSource).not.toContain("pageNavButton");
    expect(closingSource).not.toContain('name="chevron-left"');
    expect(closingSource).not.toContain('name="chevron-right"');
  });
});
