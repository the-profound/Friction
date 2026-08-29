import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const componentRoot = __dirname;
const read = (relativePath: string) =>
  readFileSync(join(componentRoot, relativePath), "utf8");

describe("CoverEditor color picker integration", () => {
  it("uses the shared spectrum picker for editable cover colors", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain('import ColorPicker from "../ColorPicker/ColorPicker"');
    expect(editor).toContain('testID="cover-text-color-picker"');
    expect(editor).toContain('testID="cover-background-color-picker"');
    expect(editor).not.toContain("TEXT_COLORS");
    expect(editor).not.toContain("BG_COLORS");
  });

  it("keeps background controls specific to solid covers without restoring removed image controls", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain('local.type === "color"');
    expect(editor).not.toContain("pickAndUpload");
    expect(editor).not.toContain("useImageUpload");
  });

  it("restores and sanitizes saved colors every time the editor opens", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain("resolveArticleCover(cover)");
    expect(editor).toContain("if (visible)");
    expect(editor).toContain("onChange(next)");
  });
});