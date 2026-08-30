import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const workspaceRoot = join(appRoot, "../..");
const nativePhotoPackages = [
  "expo-image-picker",
  "expo-image-manipulator",
  "expo-media-library",
  "react-native-view-shot",
];

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function sourceFiles(relativeDirectory: string): string[] {
  const root = join(appRoot, relativeDirectory);
  const result: string[] = [];

  for (const name of readdirSync(root)) {
    const absolutePath = join(root, name);
    if (statSync(absolutePath).isDirectory()) {
      if (name === "__tests__") continue;
      result.push(...sourceFiles(relative(appRoot, absolutePath)));
    } else if (/\.[cm]?[jt]sx?$/.test(name) && name !== "editorHtml.ts") {
      result.push(absolutePath);
    }
  }

  return result;
}

describe("native photo feature removal", () => {
  it("allows only the cover picker to reference the photo library native module", () => {
    const routeLoadableFiles = [
      ...sourceFiles("app"),
      ...sourceFiles("components"),
      ...sourceFiles("lib"),
    ];

    for (const filePath of routeLoadableFiles) {
      const source = readFileSync(filePath, "utf8");
      for (const packageName of nativePhotoPackages) {
        const relativePath = relative(appRoot, filePath);
        const isAllowedCoverPicker =
          relativePath === "lib/coverPhotoPicker.ts" &&
          packageName === "expo-image-picker";
        if (!isAllowedCoverPicker) {
          expect(source, `${relativePath} imports ${packageName}`).not.toContain(packageName);
        }
      }
    }
    const coverPicker = read("lib/coverPhotoPicker.ts");
    expect(coverPicker).toContain('await import("expo-image-picker")');
    expect(coverPicker).not.toMatch(/^import .*expo-image-picker/m);
  });

  it("declares only the cover picker package and minimal photo permission", () => {
    const packageJson = read("package.json");
    const appConfig = read("app.config.js");
    const workspaceConfig = readFileSync(join(workspaceRoot, "pnpm-workspace.yaml"), "utf8");

    expect(packageJson).toContain('"expo-image-picker"');
    expect(appConfig).toContain('"expo-image-picker"');
    for (const packageName of nativePhotoPackages.filter((name) => name !== "expo-image-picker")) {
      expect(packageJson).not.toContain(packageName);
      expect(appConfig).not.toContain(packageName);
      expect(workspaceConfig).not.toContain(packageName);
    }
    expect(workspaceConfig).not.toContain("expo-image-picker");

    for (const permission of [
      "READ_EXTERNAL_STORAGE",
      "WRITE_EXTERNAL_STORAGE",
      "READ_MEDIA_VISUAL_USER_SELECTED",
      "READ_MEDIA_IMAGES",
      "READ_MEDIA_VIDEO",
    ]) {
      expect(appConfig).not.toContain(permission);
    }

    expect(existsSync(join(appRoot, "lib/useImageUpload.ts"))).toBe(false);
    expect(existsSync(join(appRoot, "components/SaveAsPhotos/SaveAsPhotosModal.tsx"))).toBe(false);
  });

  it("keeps historical remote inline-image display and persistence support", () => {
    const inlineImages = read("lib/inlineImages.ts");
    const nativeEditor = read("components/WebViewMarkdownEditor/editorWebviewSrc/index.ts");
    const webEditor = read("components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx");

    expect(inlineImages).toContain("isPersistableInlineImageUrl");
    expect(inlineImages).toContain("getInlineImageTransformUrl");
    expect(nativeEditor).toContain('name: "inlineImage"');
    expect(nativeEditor).toContain('"data-original-src"');
    expect(webEditor).toContain('name: "inlineImage"');
    expect(webEditor).toContain('"data-original-src"');
  });

  it("keeps image cover rendering and limits image creation to the cover editor", () => {
    const preview = read("components/ArticleCardItem/ArticleCardCover.tsx");
    const editor = read("components/CoverEditor/CoverEditor.tsx");

    expect(preview).toContain('coverType === "image"');
    expect(preview).toContain("const imageUrl = cover?.imageUrl");
    expect(editor).toContain('key: "image"');
    expect(editor).toContain("사진 선택");
    expect(editor).toContain("이미지 변경");
  });

  it("does not expose photo creation, retry, or device-save actions", () => {
    const writing = read("app/on-01a.tsx");
    const archiveDetail = read("app/of-01-detail.tsx");
    const addMenu = read("components/MemoToolbar/AddMenuPopup.tsx");
    const inlineMenu = read("components/InlineMenuPanel/InlineMenuPanel.tsx");
    const editorTypes = read("components/WebViewMarkdownEditor/types.ts");

    expect(writing).not.toContain("onImageRetry");
    expect(archiveDetail).not.toContain("사진으로 저장");
    expect(archiveDetail).not.toContain("SaveAsPhotos");
    expect(addMenu).not.toContain("onSelectPhoto");
    expect(addMenu).not.toContain(">사진<");
    expect(inlineMenu).not.toContain('label: "사진"');
    expect(editorTypes).not.toContain("insertImage");
    expect(editorTypes).not.toContain("replaceImage");
    expect(editorTypes).not.toContain("setImageUploadState");
    expect(editorTypes).not.toContain("onImageRetry");
  });
});