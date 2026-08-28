import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");
const readAddMenu = () =>
  readFileSync(join(appRoot, "components/MemoToolbar/AddMenuPopup.tsx"), "utf8");

describe("on-01a initial WebView export autosave regression", () => {
  it("ignores the export caused by injecting unchanged server content", () => {
    const screen = readScreen();

    expect(screen).toContain('const canPopToList = router.canGoBack() && previousRoute?.name === "(tabs)";');
    expect(screen).toContain("router.back();");
    expect(screen).toContain('router.replace(source === "quote" ? "/(tabs)/archive" : "/(tabs)/on");');
  });

  it("routes edge swipes, browser history, and Android back through the guarded exit", () => {
    const screen = readScreen();
    const exportHandler = screen.slice(
      screen.indexOf("const handleAutosaveExport"),
      screen.indexOf("const handleEditorChange"),
    );

    expect(exportHandler).toContain("serverInjectionPendingRef.current = false;");
    expect(exportHandler).toContain("markDirty(titleRef.current, md);");
    expect(screen).toContain(
      "pendingExportsRef.current.set(requestId, handleAutosaveExport);",
    );
  });
});

describe("on-01a direct thought editor initialization regression", () => {
  it("disables only the trailing paragraph for a new local thought", () => {
    const screen = readScreen();

    expect(screen).toContain('const canPopToList = router.canGoBack() && previousRoute?.name === "(tabs)";');
    expect(screen).toContain("router.back();");
    expect(screen).toContain('router.replace(source === "quote" ? "/(tabs)/archive" : "/(tabs)/on");');
  });

  it("routes edge swipes, browser history, and Android back through the guarded exit", () => {
    const screen = readScreen();
    const promotion = screen.slice(
      screen.indexOf("// Replace route with the new article id"),
      screen.indexOf("// ── 분할 → 마감", screen.indexOf("// Replace route with the new article id")),
    );
    const removalGuard = screen.slice(
      screen.indexOf("const handlePreventedRemoval"),
      screen.indexOf("const handleDismissKeyboard"),
    );

    expect(screen).toContain('import { usePreventRemove } from "expo-router/build/react-navigation/core";');
    expect(promotion).toContain("navigateAfterRemovingGuard(() => {");
    expect(promotion).toContain("router.replace({ pathname: \"/on-01a\"");
    expect(removalGuard).toContain("usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);");
    expect(removalGuard).toContain("if (isNavigatingRef.current) return;");
    expect(removalGuard).toContain("handleHeaderBack();");
    expect(screen).toContain("<Stack.Screen options={{ gestureEnabled: true }} />");
    expect(screen).toContain("exitToPreviousList();");
  });
});

describe("on-01a photo insertion regression", () => {
  it("does not connect the writing screen to a photo picker", () => {
    const screen = readScreen();

    expect(screen).not.toContain("onSelectPhoto");
    expect(screen).not.toContain("imagePickerVisible");
    expect(screen).not.toContain("handleInsertImage");
    expect(screen).not.toContain("pickAndUpload");
    expect(screen).not.toContain("ActionSheetModal");
    expect(screen).toContain("onImageRetry={retryInlineImage}");
    expect(screen).toContain("onSelectQuote={handleSelectQuoteFromAddMenu}");
  });

  it("closes the add menu without invoking a photo picker when photo is unavailable", () => {
    const addMenu = readAddMenu();

    expect(addMenu).toContain("onPress={onSelectPhoto ?? onDismiss}");
    expect(addMenu).toContain('color={onSelectPhoto ? "#3f3f46" : "#a1a1aa"}');
    expect(addMenu).toContain("!onSelectPhoto && styles.labelDisabled");
  });
});

    const memoEditor = readFileSync(
      join(appRoot, "components/MemoWebEditor/MemoWebEditor.tsx"),
      "utf8",
    );

    const types = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/types.ts"),
      "utf8",
    );

    const editorWeb = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx"),
      "utf8",
    );

    const editorSource = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/editorWebviewSrc/index.ts"),
      "utf8",
    );

    const editorBundle = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/editorHtml.ts"),
      "utf8",
    );
