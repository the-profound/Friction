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

  it("keeps background controls specific to solid covers and exposes cover-only photo controls", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain('local.type === "color"');
    expect(editor).toContain('{ key: "image", label: "사진"');
    expect(editor).toContain("pickCoverPhoto()");
    expect(editor).toContain("uploadCoverPhoto(articleId, photo)");
    expect(editor).toContain('"이미지 변경"');
    expect(editor).not.toContain("useImageUpload");

    const typeSelection = editor.slice(
      editor.indexOf('if (type === "image")'),
      editor.indexOf("const isPhotoBusy"),
    );
    expect(typeSelection).toContain("setPhotoPanelVisible(true)");
    expect(typeSelection).not.toContain("void selectPhoto()");
    expect(editor).toContain("onPress={selectPhoto}");
  });

  it("restores and sanitizes saved colors every time the editor opens", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain("resolveArticleCover(cover)");
    expect(editor).toContain("if (visible)");
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

  it("keeps closing read-only and finalizes the cover saved by an earlier stage", () => {
    const closingScreen = read("../../app/on-01c.tsx");
    const exportFlow = closingScreen.slice(
      closingScreen.indexOf("const handleConfirmExport"),
      closingScreen.indexOf("const handleBack"),
    );

    expect(closingScreen).not.toContain('import CoverEditor from');
    expect(closingScreen).not.toContain("persistCover");
    expect(closingScreen).not.toContain("coverSaveQueueRef");
    expect(closingScreen).toContain("<CoverPreview");
    expect(closingScreen).toContain("cover={cover}");
    expect(exportFlow).toContain("data: patchData");
    expect(exportFlow).toContain("await finalizeExport()");
  });
});