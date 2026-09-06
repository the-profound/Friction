import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "..");
const read = (relativePath: string) =>
  readFileSync(join(appRoot, relativePath), "utf8");

describe("dedicated cover-edit page layout (Task #2020)", () => {
  const screen = read("on-01c-cover.tsx");

  it("is a plain full page, not a bottom sheet, and has no dim overlay", () => {
    expect(screen).not.toContain('from "@/components/BottomSheet/BottomSheet"');
    expect(screen).not.toContain("<BottomSheet");
    expect(screen).not.toContain("<Modal");
    expect(screen).not.toContain("rgba(0, 0, 0");
    expect(screen).not.toContain("dimAnim");
  });

  it("measures the top preview area and bounds the preview to fit inside it", () => {
    // The preview must be shrunk to fit the available top-half height rather
    // than stretching to full device width (which, combined with the card's
    // aspect ratio, can render taller than the top half and overflow into the
    // controls area below it).
    expect(screen).toContain("onLayout={(e) => {");
    expect(screen).toContain("setPreviewAreaSize");
    expect(screen).toContain("ReaderTokens.aspectRatio");
    expect(screen).toContain("Math.min(previewAreaSize.width, heightBoundWidth)");
    expect(screen).not.toMatch(/<CoverPreview[^>]*\/>\s*<\/View>\s*<View style=\{styles\.controlsArea\}/);
  });

  it("splits the screen into a top preview half and a bottom fixed controls half", () => {
    const previewAreaStyle = screen.match(/previewArea:\s*\{([^}]*)\}/)?.[1] ?? "";
    const controlsAreaStyle = screen.match(/controlsArea:\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(previewAreaStyle).toContain("flex: 1");
    expect(controlsAreaStyle).toContain("flex: 1");
  });

  it("flushes the pending cover save before navigating back", () => {
    const handleBack = screen.match(/const handleBack = useCallback\(async \(\) => \{[\s\S]*?\n {2}\}, \[[^\]]*\]\);/)?.[0] ?? "";
    expect(handleBack).toContain("await flushCoverSave()");
    expect(handleBack).toContain("router.back()");
  });

  it("blocks leaving while a cover photo upload is in progress", () => {
    expect(screen).toContain("isCoverUploadingRef.current");
    expect(screen).toContain("setCoverPhotoUploadInProgress");
  });

  it("never mounts the editor with a throwaway default cover before the real cover is known", () => {
    // Regression: `cover` used to start at getDefaultCover() and only sync
    // from the article one render later (via an effect), so CoverEditor
    // could mount showing/holding the default cover and a user edit could
    // overwrite the article's real saved cover. `cover` must now start as
    // `null`, be initialized synchronously from an already-cached article via
    // a lazy initializer, and the page must not render CoverEditor/CoverPreview
    // until it is resolved.
    expect(screen).not.toContain("getDefaultCover");
    expect(screen).toMatch(
      /useState<ArticleCover \| null>\(\s*\(\)\s*=>\s*\n?\s*article \? resolveArticleCover\(article\.cover\) : null,?\s*\);/,
    );
    expect(screen).toContain("if (!id || articleLoading || cover === null) {");
  });
});
