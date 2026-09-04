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

  it("removes cover-type selection and combines color and photo background settings", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).not.toContain("COVER_TYPES");
    expect(editor).not.toContain("표지 타입");
    expect(editor).toContain("pickCoverPhoto()");
    expect(editor).toContain("uploadCoverPhoto(articleId, photo)");
    expect(editor).toContain('"사진 추가"');
    expect(editor).not.toContain("useImageUpload");
    expect(editor).toContain("onPress={selectPhoto}");
    expect(editor).toContain('update({ type: "color", bgColor })');
  });

  it("restores and sanitizes saved colors every time the editor opens", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain("resolveArticleCover(cover)");
    expect(editor).toContain("if (!visible) return");
    expect(editor).toContain("onChange(next)");
  });

  it("only applies an image cover after upload succeeds and keeps a retryable error", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor.indexOf("await uploadCoverPhoto(articleId, photo)")).toBeLessThan(
      editor.indexOf("await onCommitPhotoCover(next)"),
    );
    const commitIndex = editor.indexOf("await onCommitPhotoCover(next)");
    expect(editor.indexOf("await onCommitPhotoCover(next)")).toBeLessThan(
      editor.indexOf("setLocal(next)", commitIndex),
    );
    expect(editor).toContain("photoOperationInProgressRef.current");
    expect(editor).toContain("retryPhotoRef.current");
    expect(editor).toContain("retryUploadedImageUrlRef.current");
    expect(editor).toContain("다시 시도");
    expect(editor).toContain("accessibilityState={{ disabled: isPhotoBusy, busy: isPhotoBusy }}");
  });

  it("keeps the closing body read-only while cover editing stays behind the stage menu", () => {
    const closingScreen = read("../../app/on-01c.tsx");
    const exportFlow = closingScreen.slice(
      closingScreen.indexOf("const handleConfirmExport"),
      closingScreen.indexOf("const handleBack"),
    );

    expect(closingScreen).toContain('import CoverEditor from');
    expect(closingScreen).toContain('label: "표지 편집"');
    expect(closingScreen).toContain("setPreviewPage(0)");
    expect(closingScreen).toContain("setCoverEditorVisible(true)");
    expect(closingScreen).toContain("<CoverEditor");
    expect(closingScreen).toContain("persistCover");
    expect(closingScreen).toContain("coverSaveQueueRef");
    expect(closingScreen).toContain("<CoverPreview");
    expect(closingScreen).toContain("cover={cover}");
    expect(closingScreen).toContain("sheetTranslateYAnim={coverSheetTranslateYAnim}");
    expect(closingScreen).toContain("coverPreviewAnimStyle");
    expect(exportFlow).toContain("await persistCover(coverToSave)");
    expect(exportFlow).toContain("await finalizeExport()");
  });

  it("uses three fixed controls with accessible font, text, and background actions", () => {
    const editor = read("CoverEditor.tsx");
    expect(editor).toContain("const CONTROL_HEIGHT = 56");
    expect(editor).toContain('testID="cover-font-toggle"');
    expect(editor).toContain('testID="cover-text-color-button"');
    expect(editor).toContain('testID="cover-background-button"');
    expect(editor).toContain('fontFamily === "sans" ? "serif" : "sans"');
    expect(editor).toContain('accessibilityState={{ selected: panel === "text"');
  });
});