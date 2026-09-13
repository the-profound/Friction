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
    expect(editor).toContain("await uploadCoverPhoto(");
    expect(editor).toContain('"사진 추가"');
    expect(editor).not.toContain("useImageUpload");
    expect(editor).toContain("onPress={selectPhoto}");
    expect(editor).toContain('update({ type: "color", bgColor })');
  });

  it("removes the '배경' panel title and aligns the photo button on the color/hex row", () => {
    const editor = read("CoverEditor.tsx");

    // No standalone background-panel title text/row anymore — the photo
    // button is passed as the background ColorPicker's row accessory, so it
    // renders on the same line as "배경 색상 #FAFAFA" instead of in its own
    // row above the picker (which previously misaligned the picker itself
    // relative to the text-color picker).
    expect(editor).not.toContain("panelTitle");
    expect(editor).not.toContain("photoButtonRow");
    expect(editor).toMatch(/<ColorPicker[\s\S]*?accessory=\{/);
    expect(editor).toMatch(/accessory=\{[\s\S]*?<ScalePressable[\s\S]*?testID="cover-photo-button"/);
    // The "배경" text that remains is the control-row caption under the
    // background swatch/photo icon, not a section title — distinct concern,
    // left untouched (out of scope).
    expect(editor).toContain('<Text style={styles.controlLabel}>배경</Text>');
  });

  it("renders the photo button on the same row as the color picker's label/hex text", () => {
    const picker = read("../ColorPicker/ColorPicker.tsx");

    expect(picker).toContain("accessory?: React.ReactNode");
    expect(picker).toContain("{accessory ? <View style={styles.valueAccessory}>{accessory}</View> : null}");
    const valueRowStyle = picker.match(/valueRow:\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(valueRowStyle).toContain('justifyContent: "space-between"');
  });

  it("is a plain, always-mounted content component with no BottomSheet/visible/onClose chrome", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).not.toContain('from "@/components/BottomSheet/BottomSheet"');
    expect(editor).not.toContain("<BottomSheet");
    expect(editor).not.toContain("visible:");
    expect(editor).not.toContain("visible,");
    expect(editor).not.toContain("visible}");
    expect(editor).not.toContain("onClose");
    expect(editor).not.toContain("sheetTranslateYAnim");
  });

  it("sanitizes the cover exactly once when the dedicated edit page mounts", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor).toContain("resolveArticleCover(cover)");
    expect(editor).toContain("didSanitizeRef.current = true");
    expect(editor).toContain("onChange(next)");
    // No longer gated on a `visible` prop transition — the page itself only
    // ever mounts this component once per visit.
    expect(editor).not.toContain("if (!visible) return");
  });

  it("only applies an image cover after upload succeeds and keeps a retryable error", () => {
    const editor = read("CoverEditor.tsx");

    expect(editor.indexOf("await uploadCoverPhoto(")).toBeLessThan(
      editor.indexOf("await onCommitPhotoCover(savedCover)"),
    );
    const commitIndex = editor.indexOf("await onCommitPhotoCover(savedCover)");
    expect(commitIndex).toBeLessThan(
      editor.indexOf("setLocal(savedCover)", commitIndex),
    );
    expect(editor).toContain("photoOperationInProgressRef.current");
    expect(editor).toContain("retryPhotoRef.current");
    expect(editor).toContain("retryAttemptRef.current");
    expect(editor).toContain("await onPreparePhotoCommit()");
    expect(editor).toContain('retryErrorCodeRef.current === "invalid-image"');
    expect(editor).toContain('retryErrorCodeRef.current === "staged-missing"');
    expect(editor).toContain("다시 시도");
    expect(editor).toContain("accessibilityState={{ disabled: isPhotoBusy, busy: isPhotoBusy }}");
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

  it("moves cover editing off the closing screen's bottom sheet and into a dedicated full page", () => {
    const closingScreen = read("../../app/on-01c.tsx");

    expect(closingScreen).not.toContain("import CoverEditor");
    expect(closingScreen).not.toContain("setCoverEditorVisible");
    expect(closingScreen).not.toContain("<CoverEditor");
    expect(closingScreen).not.toContain("coverSaveQueueRef");
    expect(closingScreen).not.toContain("persistCover");
    expect(closingScreen).not.toContain("coverPreviewAnimStyle");
    expect(closingScreen).not.toContain("sheetTranslateYAnim");
    expect(closingScreen).not.toContain("coverUploadInProgressRef");

    expect(closingScreen).toContain('label: "표지 편집"');
    expect(closingScreen).toContain('pathname: "/on-01c-cover"');
    expect(closingScreen).toContain("<CoverPreview");
    expect(closingScreen).toContain("cover={cover}");
    // Cover is now derived reactively from the article query cache instead of
    // duplicated local state, so a return trip from the edit page is always
    // reflected without extra sync code.
    expect(closingScreen).toContain(
      "const cover = article ? resolveArticleCover(article.cover) : getDefaultCover();",
    );
    // Export still guards against an in-flight cover photo operation, now via
    // the cross-screen singleton instead of a locally-owned ref.
    expect(closingScreen).toContain("isCoverPhotoUploadInProgress(id)");
    expect(closingScreen).toContain("표지 사진 업로드가 끝난 뒤 내보낼 수 있어요.");
    expect(closingScreen).toContain("waitForLatestArticleCoverSave(id).then((saved)");
  });

  it("the dedicated cover-edit page renders always-expanded and commits the latest cover without blocking navigation", () => {
    const coverPage = read("../../app/on-01c-cover.tsx");

    expect(coverPage).not.toContain('from "@/components/BottomSheet/BottomSheet"');
    expect(coverPage).not.toContain("<BottomSheet");
    expect(coverPage).not.toContain("<Modal");
    expect(coverPage).toContain("표지 편집");
    expect(coverPage).toContain("<CoverPreview");
    expect(coverPage).toContain("<CoverEditor");

    // Back navigation (header button / swipe / hardware back all funnel
    // through handleBack) stages the latest value without awaiting the network.
    expect(coverPage).toContain("commitLatestCover()");
    expect(coverPage).not.toContain("await flushCoverSave()");
    expect(coverPage).toContain("router.back()");
    expect(coverPage).toContain("usePreventRemove(shouldPreventRemoval, handlePreventedRemoval)");
    expect(coverPage).toContain('BackHandler.addEventListener("hardwareBackPress"');

    // Photo upload in progress must still block leaving, same as export.
    expect(coverPage).toContain("표지 사진 작업이 끝난 뒤 이동할 수 있어요.");
    expect(coverPage).toContain("setCoverPhotoUploadInProgress(id, uploading)");
  });
});
