import { describe, expect, it } from "vitest";
import {
  computeEditorViewportScrollTop,
  resolveActiveSelectionEndpoint,
  resolveEditorBottomVisibility,
} from "../editorViewport";

describe("native editor viewport scroll correction", () => {
  it("preserves the user's scroll position while the caret is already visible", () => {
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 320,
        maxScrollTop: 1_400,
        viewportHeight: 500,
        marginPx: 16,
        caretTop: 600,
        caretBottom: 630,
      }),
    ).toBe(320);
  });

  it("reveals a caret hidden below the keyboard-facing edge", () => {
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 320,
        maxScrollTop: 1_400,
        viewportHeight: 500,
        marginPx: 16,
        caretTop: 850,
        caretBottom: 880,
      }),
    ).toBe(396);
  });

  it("excludes floating toolbar height from the visible bottom edge", () => {
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 320,
        maxScrollTop: 1_400,
        viewportHeight: 500,
        marginPx: 16,
        obscuredBottomPx: 64,
        caretTop: 760,
        caretBottom: 780,
      }),
    ).toBe(360);
  });

  it("reveals a caret above the visible editor after a viewport change", () => {
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 500,
        maxScrollTop: 1_400,
        viewportHeight: 500,
        marginPx: 16,
        caretTop: 420,
        caretBottom: 450,
      }),
    ).toBe(404);
  });

  it("keeps the scroll position still when ordinary typing wraps a line but the caret stays within the margin", () => {
    // Simulates a normal, unrequested-scroll-free keystroke: the caret moves
    // down by one wrapped line's height, but both its old and new edges
    // remain inside the visible margin — this must never produce a scroll
    // change, matching the "don't auto-scroll ordinary typing" contract that
    // the editor's own default caret-follow behavior must also respect.
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 320,
        maxScrollTop: 1_400,
        viewportHeight: 500,
        marginPx: 16,
        caretTop: 590,
        caretBottom: 614,
      }),
    ).toBe(320);
  });

  it("clamps stale iOS offsets when document height shrinks or reflows", () => {
    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 1_900,
        maxScrollTop: 1_200,
        viewportHeight: 500,
        marginPx: 16,
      }),
    ).toBe(1_200);

    expect(
      computeEditorViewportScrollTop({
        currentScrollTop: 1_190,
        maxScrollTop: 1_200,
        viewportHeight: 500,
        marginPx: 16,
        caretTop: 1_690,
        caretBottom: 1_740,
      }),
    ).toBe(1_200);
  });
});

describe("editor bottom visibility contract", () => {
  it("adds scroll range only while floating chrome is visible", () => {
    expect(resolveEditorBottomVisibility({
      basePadding: 24,
      toolbarVisible: true,
      toolbarOccupiedHeight: 64,
    })).toEqual({ contentBottomPadding: 88, obscuredBottomPx: 64 });
    expect(resolveEditorBottomVisibility({
      basePadding: 24,
      toolbarVisible: false,
      toolbarOccupiedHeight: 64,
    })).toEqual({ contentBottomPadding: 24, obscuredBottomPx: 0 });
  });
});

describe("active selection endpoint", () => {
  const upper = { left: 20, right: 21, top: 100, bottom: 120 };
  const lower = { left: 220, right: 221, top: 500, bottom: 520 };

  it("tracks the lower handle regardless of selection direction", () => {
    expect(resolveActiveSelectionEndpoint({
      touchX: 220,
      touchY: 510,
      anchorRect: upper,
      headRect: lower,
    })).toBe("head");
    expect(resolveActiveSelectionEndpoint({
      touchX: 220,
      touchY: 510,
      anchorRect: lower,
      headRect: upper,
    })).toBe("anchor");
  });

  it("tracks the upper handle in the reverse drag direction", () => {
    expect(resolveActiveSelectionEndpoint({
      touchX: 20,
      touchY: 110,
      anchorRect: lower,
      headRect: upper,
    })).toBe("head");
  });
});