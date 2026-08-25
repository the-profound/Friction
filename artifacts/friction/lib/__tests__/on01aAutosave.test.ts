import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");

describe("on-01a initial WebView export autosave regression", () => {
  it("ignores the export caused by injecting unchanged server content", () => {
    const screen = readScreen();

    expect(screen).toContain("const serverInjectionPendingRef = useRef(false);");
    expect(screen).toContain("if (serverInjectionPendingRef.current) {");
    expect(screen).toContain("if (md === serverContentRef.current) {");
    expect(screen).toContain("ignored initial server export");
  });

  it("keeps changed exports on the existing autosave path", () => {
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

describe("on-01a return navigation regression", () => {
  it("pops back to the actual tab list after save instead of replacing it", () => {
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