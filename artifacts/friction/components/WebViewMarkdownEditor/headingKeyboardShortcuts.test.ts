import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { shouldConvertHeadingToParagraph } from "./headingKeyboardShortcuts";

function createEditorLike({
  parentType = "heading",
  parentOffset = 0,
  empty = true,
  textContent = "제목이 있어요",
}: {
  parentType?: string;
  parentOffset?: number;
  empty?: boolean;
  textContent?: string;
} = {}) {
  const setParagraph = vi.fn(() => true);
  return {
    state: {
      selection: {
        empty,
        $from: {
          parentOffset,
          parent: {
            type: { name: parentType },
            textContent,
          },
        },
      },
    },
    commands: { setParagraph },
  };
}

describe("heading paragraph keyboard shortcut", () => {
  it("converts a non-empty heading when the caret is at its beginning", () => {
    const editor = createEditorLike({ textContent: "본문이 뒤에 있어요" });

    expect(shouldConvertHeadingToParagraph(editor)).toBe(true);
  });

  it("requires a collapsed caret at the start of a heading", () => {
    expect(shouldConvertHeadingToParagraph(createEditorLike({ parentOffset: 1 }))).toBe(false);
    expect(shouldConvertHeadingToParagraph(createEditorLike({ empty: false }))).toBe(false);
    expect(shouldConvertHeadingToParagraph(createEditorLike({ parentType: "paragraph" }))).toBe(false);
  });

  it("registers backward-delete keys for Windows and macOS", () => {
    const source = readFileSync(new URL("./headingKeyboardShortcuts.ts", import.meta.url), "utf8");

    expect(source).toContain("Backspace:");
    expect(source).toContain("Delete:");
  });
});