import { describe, expect, it } from "vitest";
import { computeEditorViewportScrollTop } from "../editorViewport";

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