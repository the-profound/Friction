import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readScreen = (path: string) => readFileSync(join(appRoot, path), "utf8");

describe("non-blocking editor transitions", () => {
  it("exposes the closing actions from the shared stage menu", () => {
    const screen = readScreen("app/on-01c.tsx");

    expect(screen).toContain('current="CLOSING"');
    expect(screen).toContain('label: "검토 단계로"');
    expect(screen).toContain('label: "표지 편집"');
    expect(screen).toContain('label: "내보내기"');
    expect(screen).not.toContain("exportButton");
    expect(screen).not.toContain("coverActionSection");
    expect(screen).not.toContain("coverActionButton");
    expect(screen).toContain("<WritingStateBar");
  });

  it("lets every closing-screen back action navigate once while saves continue", () => {
    const screen = readScreen("app/on-01c.tsx");
    const backHandler = screen.slice(
      screen.indexOf("const handleBack"),
      screen.indexOf("const handleStepBack"),
    );
    const removalGuard = screen.slice(
      screen.indexOf("const handlePreventedRemoval"),
      screen.indexOf("const hasCoverPage"),
    );

    expect(backHandler).toContain("Promise.allSettled([flushCoverSave()])");
    expect(backHandler).not.toContain("await flushCoverSave()");
    expect(backHandler).toContain('navigateAfterRemovingGuard(() => router.replace("/(tabs)/on"))');
    expect(removalGuard).toContain(
      "usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);",
    );
    expect(removalGuard).toContain("if (isActionInProgressRef.current) return;");
    expect(removalGuard).toContain("handleBack();");
    expect(screen).toContain("<Stack.Screen options={{ gestureEnabled: true }} />");
    expect(screen).toContain('BackHandler.addEventListener("hardwareBackPress"');
  });

  it("returns directly to the integrated dividing screen from closing", () => {
    const screen = readScreen("app/on-01c.tsx");
    const stepBackHandler = screen.slice(
      screen.indexOf("const handleStepBack"),
      screen.indexOf("const handleSaveTitle"),
    );

    expect(stepBackHandler).toContain('pathname: "/on-01a"');
    expect(stepBackHandler).toContain('mode: "dividing"');
    expect(stepBackHandler).not.toContain('pathname: "/on-01b"');
    expect(stepBackHandler).toContain("status: \"DIVIDING\"");
    expect(stepBackHandler).toContain("Promise.allSettled([flushCoverSave()])");
    expect(stepBackHandler.indexOf("stageArticleTransitionSnapshot(")).toBeLessThan(
      stepBackHandler.indexOf("navigateAfterRemovingGuard("),
    );
  });

  it("opens closing immediately after the local recovery snapshot is durable", () => {
    const screen = readScreen("app/on-01a.tsx");
    const nextHandler = screen.slice(
      screen.indexOf("const handleNextToClosing"),
      screen.indexOf("// ── 작성/분할 모드 뒤로가기"),
    );

    expect(nextHandler).toContain("await persistLatestAutosave();");
    expect(nextHandler).toContain('status: "CLOSING"');
    expect(nextHandler).toContain('pathname: "/on-01c"');
    expect(nextHandler.indexOf("await persistLatestAutosave();")).toBeLessThan(
      nextHandler.indexOf("router.push("),
    );
    expect(nextHandler.indexOf("router.push(")).toBeLessThan(
      nextHandler.indexOf("const flushResult = await flush();"),
    );
    expect(nextHandler).toContain("최신 검토 내용을 저장하지 못했어요");
  });

  it("keeps the first guarded navigation intent through deferred dispatch", () => {
    const screen = readScreen("app/on-01c.tsx");
    const navigationGuard = screen.slice(
      screen.indexOf("const navigateAfterRemovingGuard"),
      screen.indexOf("const handleExport"),
    );
    const exportHandler = screen.slice(
      screen.indexOf("const handleConfirmExport"),
      screen.indexOf("const handleCoverUploadStateChange"),
    );

    expect(navigationGuard).toContain("if (navigationCommittedRef.current) return;");
    expect(navigationGuard).toContain("navigationCommittedRef.current = true;");
    expect(navigationGuard).toContain("isActionInProgressRef.current = true;");
    expect(exportHandler).toContain("if (!navigationCommittedRef.current) {");
    expect(exportHandler).not.toContain(
      "setIsExporting(false);\n      isActionInProgressRef.current = false;",
    );
    expect(screen).toContain("const exportPromptOpenRef = useRef(false);");
    expect(screen).toContain("if (isActionInProgressRef.current || exportPromptOpenRef.current) return;");
  });
});

describe("record list background work", () => {
  it("shows pull-to-refresh only for a user-started refresh", () => {
    const screen = readScreen("app/(tabs)/on.tsx");
    const render = screen.slice(screen.indexOf("return ("), screen.indexOf("const styles"));

    expect(screen).toContain("const [isManualRefreshing, setIsManualRefreshing] = useState(false);");
    expect(screen).toContain("const handleRefresh = useCallback(async () => {");
    expect(render).toContain(
      "refreshControl={<RefreshControl refreshing={isManualRefreshing} onRefresh={handleRefresh} />}",
    );
    expect(render).toContain(
      "<RefreshableEmpty refreshing={isManualRefreshing} onRefresh={handleRefresh}",
    );
    expect(render).not.toContain("isRefetching");
  });

  it("removes a confirmed record before waiting for query cancellation", () => {
    const screen = readScreen("app/(tabs)/on.tsx");
    const deleteHandler = screen.slice(
      screen.indexOf("const confirmDelete"),
      screen.indexOf("const archiveArticle"),
    );

    expect(deleteHandler.indexOf("snapshotRecordDeletion(queryClient, target)")).toBeLessThan(
      deleteHandler.indexOf("queryClient.cancelQueries("),
    );
    expect(deleteHandler.indexOf("removeRecordFromCache(queryClient, target)")).toBeLessThan(
      deleteHandler.indexOf("queryClient.cancelQueries("),
    );
    expect(deleteHandler).toContain(
      "restoreRecordDeletion(queryClient, rollback, deletePendingIdsRef.current)",
    );
  });
});