import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(__dirname, "SwipeableRow.tsx"), "utf8");

describe("SwipeableRow shared delete action contract", () => {
  it("claims only deliberate horizontal gestures and releases list scrolling", () => {
    expect(source).toContain("onStartShouldSetPanResponder: () => false");
    expect(source).toContain(
      "Math.abs(dx) > Math.abs(dy) * 1.5 && Math.abs(dx) > 6",
    );
    expect(source).toContain("onScrollLockRef.current?.(true)");
    expect(source.match(/onScrollLockRef\.current\?\.\(false\)/g)).toHaveLength(2);
    expect(source).toContain("onSwipeOpenRef.current?.()");
    expect(source).toContain("const revealWidth = totalWidth + actionRightInset");
    expect(source).toContain("const clamped = Math.min(0, Math.max(-revealWidth, raw))");
  });

  it("renders a fixed, rounded, shadowed brand action card", () => {
    expect(source).toContain("const BUTTON_WIDTH = 80");
    expect(source).toContain("const ACTION_RADIUS = 16");
    expect(source).toContain('label: "삭제", color: Colors.primaryAction');
    expect(source).toContain("width: BUTTON_WIDTH");
    expect(source).toContain("borderRadius: ACTION_RADIUS");
    expect(source).toContain("...Shadows.card");
    expect(source).toContain('accessibilityRole="button"');
    expect(source).toContain("disabled: Boolean(action.disabled || action.busy)");
    expect(source).toContain("busy: Boolean(action.busy)");
    expect(source).toContain('accessibilityLabel="스와이프 메뉴 닫기"');
  });

  it("keeps edge ornaments inside the translated subtree and reserves their overflow", () => {
    expect(source).toContain(
      "overflowTop > 0 && { paddingTop: overflowTop, marginTop: -overflowTop }",
    );
    expect(source).toContain("top: overflowTop");
    expect(source).toMatch(
      /<View[\s\S]*styles\.contentClip[\s\S]*<Animated\.View[\s\S]*\{\.\.\.panResponder\.panHandlers\}[\s\S]*\{children\}[\s\S]*<\/Animated\.View>/,
    );
    expect(source).toContain('container: {\n    overflow: "visible"');
    expect(source).toContain('contentClip: {\n    overflow: "hidden"');
  });
});