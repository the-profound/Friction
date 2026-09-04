import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const appRoot = join(__dirname, "../..");
const readScreen = (path: string) => readFileSync(join(appRoot, path), "utf8");

describe("non-blocking editor transitions", () => {
  it("disables stack motion for every writing-stage route", () => {
    const layout = readScreen("app/_layout.tsx");

    expect(layout).toContain(
      'name="on-01a"\n            options={{ animation: "none", animationTypeForReplace: "pop" }}',
    );
    expect(layout).toContain(
      'name="on-01b"\n            options={{ animation: "none", animationTypeForReplace: "pop" }}',
    );
    expect(layout).toContain(
      '<Stack.Screen name="on-01c" options={{ animation: "none" }} />',
    );
  });

  it("uses transition locks without showing a stage-change spinner", () => {
    const screen = readScreen("app/on-01a.tsx");
    const stageMenu = screen.slice(
      screen.indexOf("const stageMenuDisabled"),
      screen.indexOf("useEffect(() =>", screen.indexOf("const stageMenuDisabled")),
    );

    expect(stageMenu).toContain(
      'const stageMenuBusy = splitting || spellState.status === "loading";',
    );
    expect(stageMenu).toContain("disabled: isNavigating");
    expect(stageMenu).not.toContain("busy: isNavigating");
    expect(screen).toContain("disabled={stageMenuDisabled}");
    expect(screen).toContain("busy={stageMenuBusy}");
  });

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
    expect(stepBackHandler).toContain("const completeStepBackTransition = () =>");
    expect(stepBackHandler).toContain("onPress: completeStepBackTransition");
    expect(stepBackHandler.indexOf("stageArticleTransitionSnapshot(")).toBeLessThan(
      stepBackHandler.indexOf("navigateAfterRemovingGuard("),
    );
  });

  it("shows review before the thought promotion request settles", () => {
    const screen = readScreen("app/on-01a.tsx");
    const promoteHandler = screen.slice(
      screen.indexOf("const enterDividingMode"),
      screen.indexOf("// ── 검토(article)"),
    );

    expect(promoteHandler.indexOf('setModeBoth("dividing")')).toBeLessThan(
      promoteHandler.indexOf("promoteThought.mutateAsync"),
    );
    expect(promoteHandler).toContain('setModeBoth("draft")');
    expect(promoteHandler).toContain('label: "다시 시도"');
    expect(promoteHandler).toContain("retryPromotionRef.current?.()");
    expect(promoteHandler).toContain("setInlineMenuMode(null)");
    expect(promoteHandler).toContain("addMenuPendingRef.current = false");
    expect(screen).toContain("editable={!isNavigating}");
    expect(screen).toContain("isDividing && !!dividingArticle && !isNavigating");
    expect(screen).toContain('!isNavigating && Platform.OS !== "web"');
    expect(screen).toContain('!isNavigating && inlineMenuMode === "addMenu"');
  });

  it("rejects programmatic editor commands during an identity handoff", () => {
    const screen = readScreen("app/on-01a.tsx");
    const commands = screen.slice(
      screen.indexOf("const handleInsertDivider"),
      screen.indexOf("// ── 분할 조작"),
    );

    expect(commands.match(/if \(isNavigatingRef\.current\) return;/g)).toHaveLength(7);
    expect(screen).toContain(
      "if (isNavigatingRef.current) return;\n              editorRef.current?.setBlockType(blockType);",
    );
    expect(promoteHandler).toContain("setInlineMenuMode(null)");
    expect(promoteHandler).toContain("addMenuPendingRef.current = false");
    expect(screen).toContain(
      "!isNavigating && Platform.OS !== \"web\"",
    );
    expect(screen).toContain(
      "!isNavigating && inlineMenuMode === \"addMenu\"",
    );
    expect(screen).toContain(
      "!isNavigating && inlineMenuMode !== null && inlineMenuMode !== \"addMenu\"",
    );
  });

  it("rejects programmatic editor commands during an identity handoff", () => {
    const screen = readScreen("app/on-01a.tsx");
    const commands = screen.slice(
      screen.indexOf("const handleInsertDivider"),
      screen.indexOf("// ── 분할 조작"),
    );

    expect(commands.match(/if \(isNavigatingRef\.current\) return;/g)).toHaveLength(7);
    expect(screen).toContain(
      "if (isNavigatingRef.current) return;\n              editorRef.current?.setBlockType(blockType);",
    );
  });

  it("renders staged destination data instead of a transition loading fallback", () => {
    const writing = readScreen("app/on-01a.tsx");
    const closing = readScreen("app/on-01c.tsx");

    expect(writing).toContain(
      'const article = getProtectedArticleDetailSnapshot(queryClient, id ?? "", articleQuery.data);',
    );
    expect(closing).toContain(
      "getProtectedArticleDetailSnapshot(queryClient, id, articleQuery.data)",
    );
    expect(closing).toContain(
      "const articleLoading = id ? articleQuery.isLoading && !article : false;",
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