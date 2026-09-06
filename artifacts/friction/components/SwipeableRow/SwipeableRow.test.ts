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
    expect(source).toContain("const topInset = Math.max(overflowTop, SHADOW_CLIP_TOP)");
    expect(source).toContain("top: topInset");
    expect(source).toMatch(
      /<View[\s\S]*styles\.contentClip[\s\S]*<Animated\.View[\s\S]*\{\.\.\.panResponder\.panHandlers\}[\s\S]*\{children\}[\s\S]*<\/Animated\.View>/,
    );
    expect(source).toContain('container: {\n    overflow: "visible"');
    expect(source).toContain('contentClip: {\n    overflow: "hidden"');
  });

  it("reserves vertical room inside the clip so the card's own shadow is never flattened, without changing horizontal clip or row height", () => {
    // Horizontal clipping (needed to hide content sliding past the row's own
    // left edge) must stay untouched: no horizontal padding/margin trick.
    expect(source).not.toContain("paddingLeft");
    expect(source).not.toContain("paddingRight");
    expect(source).not.toContain("marginLeft");
    expect(source).not.toContain("marginRight");

    // Vertical shadow-bleed buffer: padding is always cancelled by an equal
    // negative margin on BOTH the outer container and the inner clip, so
    // list row height/spacing never changes — only the clip boundary grows.
    const bothGetTopTrick = (source.match(/paddingTop: topInset,\s*\n\s*marginTop: -topInset,/g) ?? []).length
      + (source.match(/marginTop: -topInset,\s*\n\s*paddingTop: topInset,/g) ?? []).length;
    expect(bothGetTopTrick).toBe(2);
    const bothGetBottomTrick = (source.match(/paddingBottom: bottomInset,\s*\n\s*marginBottom: -bottomInset,/g) ?? []).length
      + (source.match(/marginBottom: -bottomInset,\s*\n\s*paddingBottom: bottomInset,/g) ?? []).length;
    expect(bothGetBottomTrick).toBe(2);

    // The reveal actions must stay pinned to the card's actual visible edges
    // (unaffected by the new shadow buffer), so swipe-open/close geometry is
    // pixel-identical to before this fix.
    expect(source).toContain("bottom: bottomInset + actionBottomInset");
  });
});