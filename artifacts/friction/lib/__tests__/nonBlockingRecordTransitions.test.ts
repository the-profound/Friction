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

  it("lets every closing-screen back action navigate once while list invalidation continues", () => {
    const screen = readScreen("app/on-01c.tsx");
    const backHandler = screen.slice(
      screen.indexOf("const handleBack"),
      screen.indexOf("const handleStepBack"),
    );
    const removalGuard = screen.slice(
      screen.indexOf("const handlePreventedRemoval"),
      screen.indexOf("const hasCoverPage"),
    );

    // Cover editing (and its debounced save) now lives entirely on the
    // dedicated cover-edit page (app/on-01c-cover.tsx), which flushes its own
    // save before returning here — so the closing screen's own back action
    // only needs to invalidate lists, not flush a cover save.
    expect(backHandler).not.toContain("flushCoverSave");
    expect(backHandler).toContain("void invalidateArticleLists(queryClient)");
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
    // Cover is no longer edited on this screen, so stepping back no longer
    // needs to flush a cover save — only the title/status transition.
    expect(stepBackHandler).not.toContain("flushCoverSave");
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
    expect(promoteHandler).toContain('setRecordKindIntent("editing")');
    expect(promoteHandler).toContain('setModeBoth("draft")');
    expect(promoteHandler).toContain('setRecordKindIntent("thought")');
    expect(promoteHandler).toContain('label: "다시 시도"');
    expect(promoteHandler).toContain("retryPromotionRef.current?.()");
    expect(promoteHandler).toContain("setInlineMenuMode(null)");
    expect(promoteHandler).toContain("addMenuPendingRef.current = false");
    expect(screen).toContain("editable={!isNavigating}");
    expect(screen).toContain('!isNavigating && Platform.OS !== "web"');
    expect(screen).toContain('!isNavigating && inlineMenuMode === "addMenu"');
  });

  it("preselects editing before review and closing back navigation", () => {
    const writing = readScreen("app/on-01a.tsx");
    const closing = readScreen("app/on-01c.tsx");
    const nextHandler = writing.slice(
      writing.indexOf("const handleNextToClosing"),
      writing.indexOf("// ── 작성/분할 모드 뒤로가기"),
    );
    const closingBack = closing.slice(
      closing.indexOf("const handleBack"),
      closing.indexOf("const stageMenuBusy"),
    );

    expect(nextHandler).toContain('setRecordKindIntent("editing")');
    expect(nextHandler.indexOf('setRecordKindIntent("editing")')).toBeLessThan(
      nextHandler.indexOf("router.push("),
    );
    expect(closingBack.match(/setRecordKindIntent\("editing"\)/g)).toHaveLength(2);
  });

  it("moves newly promoted edits and ordinary exported letters to the top of their filters", () => {
    const writing = readScreen("app/on-01a.tsx");
    const closing = readScreen("app/on-01c.tsx");
    const promotion = writing.slice(
      writing.indexOf("upsertArticleInRecordCaches(queryClient"),
      writing.indexOf("// Update editor without remounting"),
    );
    const exportDestination = closing.slice(
      closing.indexOf("if (effectiveSpaceId)"),
      closing.indexOf("const handleConfirmExport"),
    );

    expect(promotion).toContain('setRecordKindIntent("editing", { scrollToTop: true })');
    expect(exportDestination).toContain('setRecordKindIntent("letter", { scrollToTop: true })');
    expect(exportDestination.indexOf('setRecordKindIntent("letter", { scrollToTop: true })'))
      .toBeGreaterThan(exportDestination.indexOf("} else {"));
  });

  it("keeps the review editor free of reply-link actions during and after promotion", () => {
    const screen = readScreen("app/on-01a.tsx");
    const editorTypes = readScreen("components/WebViewMarkdownEditor/types.ts");
    const nativeEditor = readScreen(
      "components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx",
    );
    const editorSource = readScreen(
      "components/WebViewMarkdownEditor/editorWebviewSrc/index.ts",
    );
    const editorBuilder = readScreen(
      "components/WebViewMarkdownEditor/buildEditorHtml.mjs",
    );
    const collectionDetail = readScreen("app/of-01-detail.tsx");

    expect(screen).not.toContain("이 편지를 답장으로 설정");
    expect(screen).not.toContain("sourceArticleSlotText=");
    expect(screen).not.toContain("onSourceArticleSlotTap=");
    expect(screen).not.toContain("<SourceArticlePickerSheet");
    expect(screen).not.toContain("data: { sourceArticleId:");
    expect(screen).toContain("editable={!isNavigating}");
    expect(screen).toContain('setModeBoth("dividing")');
    expect(editorTypes).not.toContain("sourceArticleSlotText");
    expect(editorTypes).not.toContain("onSourceArticleSlotTap");
    expect(editorTypes).not.toContain("setSourceArticleSlot");
    expect(nativeEditor).not.toContain("source-article-slot");
    expect(editorSource).not.toContain("source-article-slot");
    expect(editorBuilder).not.toContain("source-article-slot");
    expect(collectionDetail).not.toContain("답장 설정");
    expect(collectionDetail).not.toContain("SourceArticlePickerSheet");
    expect(collectionDetail).not.toContain("data: { sourceArticleId:");
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

  it("suppresses the not-dividing detail error only for its own in-flight closing transition", () => {
    const screen = readScreen("app/on-01a.tsx");

    // The suppression flag must be threaded into detailResolution so the
    // review screen's own optimistic status patch never flashes a false
    // "not-dividing" error, while any other cause of failure (a real 404,
    // network error, etc.) is untouched.
    expect(screen).toContain(
      "suppressNotDividingError: closingTransitionSuppressionRef.current.isPending(),",
    );

    // Reset on every focus: returning to this screen (back navigation, or a
    // failed/aborted transition landing the user back here) must re-enable
    // normal error detection. Clearing the controller alone would not cause
    // a rerender, so the focus handler must also force one whenever the
    // controller reports it actually cleared a pending suppression.
    expect(screen).toContain(
      "const closingTransitionSuppressionRef = useRef<ClosingTransitionSuppressionController>(",
    );
    const focusReset = screen.slice(
      screen.indexOf("const closingTransitionSuppressionRef = useRef<ClosingTransitionSuppressionController>("),
      screen.indexOf("// ── 데이터 fetching"),
    );
    expect(focusReset).toContain("useFocusEffect(");
    expect(focusReset).toContain("closingTransitionSuppressionRef.current.handleFocus()");
    expect(focusReset).toContain("forceDetailResolutionRecheck();");

    // The controller must begin before the optimistic cache patch that would
    // otherwise cause the very next render to see a non-DIVIDING status for
    // its own article.
    const nextHandler = screen.slice(
      screen.indexOf("const handleNextToClosing"),
      screen.indexOf("// ── 작성/분할 모드 뒤로가기"),
    );
    expect(nextHandler.indexOf("closingTransitionSuppressionRef.current.begin();")).toBeLessThan(
      nextHandler.indexOf("stageArticleTransitionSnapshot("),
    );
    expect(nextHandler).toContain('status: "CLOSING",\n    }, article);');
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

  it("saves the complete snapshot and closes before immediate export", () => {
    const screen = readScreen("app/on-01c.tsx");
    const exportHandler = screen.slice(
      screen.indexOf("const handleConfirmExport"),
      screen.indexOf("const handleCoverUploadStateChange"),
    );

    expect(exportHandler).toContain("pages.length === 0 || !article?.content?.trim()");
    expect(exportHandler).toContain("content: article.content");
    expect(exportHandler).toContain("pages,");
    expect(exportHandler).toContain("await closeArticle.mutateAsync");
    expect(exportHandler).toContain(
      "Save the complete snapshot and enter CLOSING in one server transaction.",
    );
    expect(exportHandler.indexOf("await closeArticle.mutateAsync")).toBeLessThan(
      exportHandler.indexOf("await finalizeExport()"),
    );
    expect(exportHandler).not.toContain("await updateArticle.mutateAsync");
    expect(exportHandler).not.toContain("await transitionStatus.mutateAsync");
    expect(exportHandler).not.toContain("const confirmed = await getArticle(id!)");
    expect(exportHandler).not.toContain("pagesChanged");
    expect(exportHandler).not.toContain("initialPagesRef");
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
      deleteHandler.indexOf("await cancellation"),
    );
    expect(deleteHandler.indexOf("removeRecordFromCache(queryClient, target)")).toBeLessThan(
      deleteHandler.indexOf("await cancellation"),
    );
    expect(deleteHandler.indexOf("removeThoughtQuestionFromQueueCache(queryClient, target.id)"))
      .toBeLessThan(deleteHandler.indexOf("await cancellation"));
    expect(deleteHandler).toContain(
      "restoreRecordDeletion(queryClient, rollback, deletePendingIdsRef.current)",
    );
  });

  it("keeps question long-press deletion guarded and retryable in both record views", () => {
    const screen = readScreen("app/(tabs)/on.tsx");
    const deleteHandler = screen.slice(
      screen.indexOf("const confirmDelete"),
      screen.indexOf("const archiveArticle"),
    );

    expect(screen).not.toContain("questionActionTarget");
    expect(screen).toContain("if (!shouldIgnorePress())");
    expect(screen).toContain("if (scrollPressGuard.shouldIgnoreVerticalPress()) return;");
    expect(screen).toContain("if (isCurrentQuestion) {\n                    requestRecordDeletion(item);");
    expect(screen).toContain("destructiveFilled");
    expect(deleteHandler).toContain(
      "if (isQueuedQuestion && questionQueueMutationPendingRef.current)",
    );
    expect(deleteHandler).toContain(
      "removeThoughtQuestionFromQueueCache(queryClient, target.id)",
    );
    expect(deleteHandler).toContain(
      "queryClient.setQueryData(\n              getGetThoughtQuestionQueueQueryKey(),\n              questionQueueRollback",
    );
    expect(deleteHandler).toContain(
      'showToast({ message: "삭제에 실패했습니다. 다시 시도해주세요.", type: "error" })',
    );
  });
});