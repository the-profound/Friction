import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { shouldMoveTitleFocusToBody } from "../../components/WebViewMarkdownEditor/titleKeyboardContract";
import {
  createEditorSurfaceTouchSession,
  isStationaryBlankSurfaceTap,
  updateEditorSurfaceTouchSession,
} from "../../components/WebViewMarkdownEditor/editorSurfaceTouch";

const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");
const readAutoSave = () => readFileSync(join(appRoot, "lib/useAutoSave.ts"), "utf8");
const readEditorSource = () =>
  readFileSync(
    join(appRoot, "components/WebViewMarkdownEditor/editorWebviewSrc/index.ts"),
    "utf8",
  );
const readEditorWeb = () =>
  readFileSync(
    join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx"),
    "utf8",
  );
const readEditorNative = () =>
  readFileSync(
    join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx"),
    "utf8",
  );
const readEditorTypes = () =>
  readFileSync(
    join(appRoot, "components/WebViewMarkdownEditor/types.ts"),
    "utf8",
  );

describe("on-01a editor hydration and initialization", () => {
  it("ignores only the export caused by unchanged server hydration", () => {
    const screen = readScreen();
    const exportHandler = screen.slice(
      screen.indexOf("const handleAutosaveExport"),
      screen.indexOf("const handleEditorChange"),
    );

    expect(screen).toContain("const serverInjectionPendingRef = useRef(false);");
    expect(exportHandler).toContain("serverInjectionPendingRef.current = false;");
    expect(exportHandler).toContain("if (md === serverContentRef.current) {");
    expect(exportHandler).toContain("markDirty(titleRef.current, md);");
  });

  it("does not add a synthetic body paragraph to a new direct thought", () => {
    const screen = readScreen();

    expect(screen).toContain("ensureTrailingParagraph={!isLocalDirectDraft}");
  });

  it("uses native keyboard events as the writing viewport source of truth", () => {
    const screen = readScreen();
    const keyboardTracking = screen.slice(
      screen.indexOf("// 키보드 높이 추적"),
      screen.indexOf("// 패널을 닫고"),
    );
    const webViewFocusHandler = screen.slice(
      screen.indexOf("const handleKeyboardVisibilityChange"),
      screen.indexOf("const handleInsertDivider"),
    );

    expect(keyboardTracking).toContain("setKeyboardVisible(true)");
    expect(keyboardTracking).toContain("setKeyboardVisible(false)");
    expect(webViewFocusHandler).not.toContain("setKeyboardVisible(visible)");
    expect(screen).not.toContain('Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true))');
    expect(screen).toContain(
      "contentBottomPadding={WRITING_EDITOR_BOTTOM_PADDING}",
    );
  });
});

describe("on-01a latest-snapshot autosave boundary", () => {
  it("uses collision-free request ids for overlapping WebView exports", () => {
    const screen = readScreen();

    expect(screen).toContain("const exportRequestSeqRef = useRef(0);");
    expect(screen).toContain("exportRequestSeqRef.current += 1;");
    expect(screen).toContain('nextExportRequestId("export")');
    expect(screen).toContain('nextExportRequestId("autosave")');
  });

  it("fails a lost export instead of saving an older fallback as current", () => {
    const screen = readScreen();
    const getEditorContent = screen.slice(
      screen.indexOf("const getEditorContent"),
      screen.indexOf("const acceptEditorSnapshot"),
    );

    expect(getEditorContent).toContain('pending.reject(new Error("Editor export timed out"))');
    expect(getEditorContent).toContain('reject(new Error("Editor is not ready to export the latest document"))');
    expect(getEditorContent).not.toContain("resolve(fallback)");
    expect(getEditorContent).not.toContain("resolve(bestKnown)");
  });

  it("turns background Markdown conversion failures into retryable save errors", () => {
    const screen = readScreen();

    expect(screen).toContain("const handleEditorError = useCallback");
    expect(screen).toContain('error.code !== "MARKDOWN_EXPORT_FAIL"');
    expect(screen).toContain("contentRef.current || serverContentRef.current");
    expect(screen).toContain("void reportAutosaveFailure();");
    expect(screen).toContain("onError={handleEditorError}");
  });

  it("rejects exports from a previous WebView reload session", () => {
    const screen = readScreen();
    const nativeEditor = readEditorNative();
    const types = readEditorTypes();

    expect(types).toContain("editorSessionId?: string;");
    expect(types).toContain("onReload?: (editorSessionId: string) => void;");
    expect(nativeEditor).toContain("onLoadStart={() => {");
    expect(nativeEditor).toContain('bridge.reset("WebViewMarkdownEditor reload")');
    expect(nativeEditor).toContain("onReload?.(editorSessionIdRef.current);");
    expect(screen).toContain("const handleEditorReload = useCallback");
    expect(screen).toContain("rejectPendingExports(\"Editor reloaded before export completed\")");
    expect(screen).toContain("payload.editorSessionId !== pending.editorSessionId");
    expect(screen).toContain("onReload={handleEditorReload}");
  });

  it("uses the latest editor snapshot for local handoff on back and flushes other save boundaries", () => {
    const screen = readScreen();
    const latestFlush = screen.slice(
      screen.indexOf("const flushLatestEditorSnapshot"),
      screen.indexOf("const handleTitleChange"),
    );
    const backHandler = screen.slice(
      screen.indexOf("const handleDraftBack"),
      screen.indexOf("// Native lifecycle events"),
    );
    const lifecycle = screen.slice(
      screen.indexOf("// Native lifecycle events"),
      screen.indexOf("// A direct draft owns"),
    );
    const keyboard = screen.slice(
      screen.indexOf("const handleDismissKeyboard"),
      screen.indexOf("const handleInsertDivider"),
    );

    expect(latestFlush).toContain("latest = await getEditorContent();");
    expect(latestFlush).toContain("markDirty(isThoughtModeRef.current ? \"\" : titleRef.current, latest);");
    expect(latestFlush).toContain("const result = await flush();");
    expect(backHandler).toContain("cur = await getEditorContent()");
    expect(backHandler).toContain("await persistLatestAutosave()");
    expect(backHandler).toContain("void flush().then");
    expect(backHandler).not.toContain("await flushLatestEditorSnapshot()");
    expect(backHandler).toContain("await stageCleanup(thoughtIdRef.current ?? id)");
    expect(backHandler).toContain("await runPendingCleanup(savedThoughtId)");
    const autoSave = readAutoSave();
    expect(autoSave).toContain('operation: "delete"');
    expect(autoSave).toContain("if (restored.operation === \"delete\")");
    expect(autoSave).toContain("latestDataRef.current.creationId");
    expect(autoSave).toContain("void runPendingCleanup(restored.entityId)");
    expect(autoSave).toContain("latestDataRef.current.cleanupId === cleanupId");
    expect(autoSave).toContain("cleanupId: undefined");
    expect(lifecycle).toContain("await flushLatestEditorSnapshot();");
    expect(keyboard).toContain("void flushLatestEditorSnapshot();");
    expect(screen).toContain("onKeyboardVisibilityChange={handleKeyboardVisibilityChange}");
    expect(latestFlush).toContain("latestFlushTailRef.current.then(run, run)");
    expect(latestFlush).not.toContain("return latestFlushPromiseRef.current");
  });

  it("keeps formatting-only new drafts out of the save failure path", () => {
    const screen = readScreen();
    const latestFlush = screen.slice(
      screen.indexOf("const flushLatestEditorSnapshot"),
      screen.indexOf("const handleTitleChange"),
    );

    expect(latestFlush).toContain("isMeaningfulThoughtMarkdown(latest)");
    expect(latestFlush).toContain("discardAutosave();");
    expect(latestFlush).toContain("meaningful: false");
  });

  it("removes the editor footer and its reserved status/character-count space", () => {
    const screen = readScreen();
    expect(screen).not.toContain("styles.editorFooter");
    expect(screen).not.toContain("styles.autoSaveFeedback");
    expect(screen).not.toContain("styles.charCountText");
    expect(screen).toContain("reportFailure: reportAutosaveFailure");
  });

  it("keeps each create/update request bound to one autosave snapshot", () => {
    const screen = readScreen();
    const thoughtSave = screen.slice(
      screen.indexOf("const handleSave"),
      screen.indexOf("const {", screen.indexOf("const handleSave")),
    );

    expect(thoughtSave).toContain("content: data.content");
    expect(thoughtSave).not.toContain("const latestContent = await getEditorContent()");
    expect(thoughtSave).toContain("getGetThoughtQueryKey(thoughtId)");
    expect(thoughtSave).toContain("patchThoughtInRecordCaches(queryClient, thoughtId");
  });
});

describe("useAutoSave pending-content preservation", () => {
  it("serializes queue writes and preserves the newest payload after an older request fails", () => {
    const autoSave = readAutoSave();
    const failurePath = autoSave.slice(
      autoSave.indexOf("} catch {", autoSave.indexOf("const run = async")),
      autoSave.indexOf("} finally {", autoSave.indexOf("const run = async")),
    );

    expect(autoSave).toContain("queueWriteRef.current = queueWriteRef.current.catch");
    expect(autoSave).toContain("writeQueue({ ...latestDataRef.current });");
    expect(failurePath).not.toContain("writeQueue(data)");
  });

  it("restores queued content into the visible editor before retrying it", () => {
    const autoSave = readAutoSave();
    const screen = readScreen();

    expect(autoSave).toContain("onRestoreRef.current?.(restored);");
    expect(screen).toContain("const handleAutosaveRestore = useCallback");
    expect(screen).toContain("editorRef.current?.setMarkdown(data.content);");
    expect(screen).toContain("onRestore: handleAutosaveRestore");
  });

  it("bounds storage and network waits and exposes bridge failures as retryable", () => {
    const autoSave = readAutoSave();
    const screen = readScreen();

    expect(autoSave).toContain("saveTimeoutMs = 10_000");
    expect(autoSave).toContain("storageTimeoutMs = 3_000");
    expect(autoSave).toContain("const networkSave = onSaveRef.current(data);");
    expect(autoSave).toContain("watchdog = setTimeout(() => {");
    expect(autoSave).toContain('setStatus("error");');
    expect(autoSave).toContain('"autosave queue write"');
    expect(autoSave).toContain("the physical write remains in the");
    expect(autoSave).toContain("const reportFailure = useCallback");
    expect(autoSave).toContain('setStatus("error");');
    expect(screen).toContain("reportFailure: reportAutosaveFailure");
    expect(screen).toContain("await reportAutosaveFailure();");
  });

  it("binds the first server id to both recovery keys before changing the route", () => {
    const autoSave = readAutoSave();
    const screen = readScreen();
    const createSuccess = screen.slice(
      screen.indexOf("thoughtIdRef.current = created.id;"),
      screen.indexOf(
        "// This create owns exactly the payload",
        screen.indexOf("thoughtIdRef.current = created.id;"),
      ),
    );

    expect(autoSave).toContain("const bindEntity = useCallback");
    expect(autoSave).toContain("queueKeysRef.current.add(nextQueueKey);");
    expect(autoSave).toContain("latestDataRef.current = { ...latestDataRef.current, entityId };");
    expect(autoSave).toContain("aliasQueueKeys: keys");
    expect(autoSave).toContain("for (const alias of queued.aliasQueueKeys ?? [])");
    expect(createSuccess).toContain(
      "await bindAutosaveEntityRef.current(created.id, `draft_${created.id}`);",
    );
    expect(screen).toContain("thoughtIdRef.current = data.entityId;");
    expect(screen).toContain("router.setParams({ id: data.entityId, mode: undefined });");
  });

  it("uses one durable client-generated id across ambiguous create retries", () => {
    const autoSave = readAutoSave();
    const screen = readScreen();

    expect(screen).toContain("const thoughtCreationIdRef = useRef<string | undefined>");
    expect(screen).toContain("clientId: thoughtCreationIdRef.current ?? createThoughtClientId()");
    expect(screen).toContain("if (data.creationId) thoughtCreationIdRef.current = data.creationId;");
    expect(screen).toContain("creationId: thoughtCreationIdRef.current");
    expect(autoSave).toContain("creationId?: string;");
    expect(autoSave).toContain("const latestDataRef = useRef<PendingPayload>");
    expect(autoSave).toContain(
      'await rejectAfter(queueWriteRef.current, storageTimeoutMs, "autosave queue barrier")',
    );
    expect(autoSave.indexOf("autosave queue barrier")).toBeLessThan(
      autoSave.indexOf("const networkSave = onSaveRef.current(data)"),
    );
    expect(autoSave).toContain(
      "queued.creationId ?? queued.entityId ?? latestDataRef.current.creationId",
    );
  });

  it("cancels retries scheduled while flush awaited an in-flight request", () => {
    const autoSave = readAutoSave();
    const flushBody = autoSave.slice(
      autoSave.indexOf("const flush = useCallback"),
      autoSave.indexOf("const retry = useCallback"),
    );

    expect(flushBody).toContain(
      'await rejectAfter(activeSaveRef.current, saveTimeoutMs, "active autosave request")',
    );
    expect(flushBody).toContain("clearRetryTimer();");
    expect(autoSave).not.toContain("savingRef.current = false;\n              doSave();");
  });

  it("can discard a meaningless draft without resurrecting an in-flight failure", () => {
    const autoSave = readAutoSave();

    expect(autoSave).toContain("if (!isDirtyRef.current) return;");
    expect(autoSave).toContain("const discard = useCallback");
    expect(autoSave).toContain('setStatus("idle");');
    expect(autoSave).toContain(
      "const { creationId: stableCreationId, entityId: boundEntityId } = latestDataRef.current;",
    );
    expect(autoSave).toContain("creationId: stableCreationId");
    expect(autoSave).toContain(
      "reportFailure,",
    );
    expect(autoSave).toContain("discard,");
    expect(autoSave).toContain("bindEntity,");
  });
});

describe("WebView editor autosave signals", () => {
  it("does not suppress native Korean IME or formatting changes with unchanged metrics", () => {
    const editorSource = readEditorSource();

    expect(editorSource).toContain("Korean IME composition and formatting changes");
    expect(editorSource).not.toContain("charCount === lastEmittedCharCount");
    expect(editorSource).toContain("const markdown = htmlToMarkdown(ed.getHTML(), (error) => {");
    expect(editorSource).toContain("markdown,");
    expect(editorSource).toContain("docVersion: docChangeCounter,");
    expect(editorSource).toContain("editorSessionId,");
    expect(editorSource).toContain('code: "MARKDOWN_EXPORT_FAIL"');
  });

  it("keeps the web editor's debounced document-change snapshot", () => {
    const editorWeb = readEditorWeb();

    expect(editorWeb).toContain("onUpdate: ({ editor: ed }) => {");
    expect(editorWeb).toContain("onChange?.(payload);");
    expect(editorWeb).toContain("markdown: htmlToMarkdown(ed.getHTML())");
    expect(editorWeb).toContain("editorSessionId: editorSessionIdRef.current");
    expect(editorWeb).toContain('error: { code: "MARKDOWN_EXPORT_FAIL", message }');
    expect(editorWeb).toContain('throw new Error("Failed to convert editor HTML to Markdown"');
    expect(editorWeb).not.toContain("lastEmittedCharCount");
  });
});

describe("on-01a guarded return navigation", () => {
  it("persists the latest local snapshot, starts the network save in the background, and exits once", () => {
    const screen = readScreen();
    const removalGuard = screen.slice(
      screen.indexOf("const handlePreventedRemoval"),
      screen.indexOf("const handleDismissKeyboard"),
    );

    expect(screen).toContain(
      'const canPopToList = router.canGoBack() && previousRoute?.name === "(tabs)";',
    );
    expect(screen).toContain("router.back();");
    expect(screen).toContain(
      'router.replace(source === "quote" ? "/(tabs)/archive" : "/(tabs)/on");',
    );
    expect(removalGuard).toContain(
      "usePreventRemove(shouldPreventRemoval, handlePreventedRemoval);",
    );
    expect(removalGuard).toContain("if (isNavigatingRef.current) return;");
    expect(removalGuard).toContain("handleHeaderBack(data.action);");
    const backHandler = screen.slice(
      screen.indexOf("const handleDraftBack"),
      screen.indexOf("// Native lifecycle events"),
    );
    expect(backHandler).toContain("await persistLatestAutosave();");
    expect(backHandler).toContain("void flush().then");
    expect(backHandler.indexOf("await persistLatestAutosave();")).toBeLessThan(
      backHandler.indexOf(
        "exitToPreviousList(removalAction);",
        backHandler.indexOf("await persistLatestAutosave();"),
      ),
    );
    expect(backHandler).not.toContain("await flush()");
    expect(screen).toContain("<Stack.Screen options={{ gestureEnabled: true }} />");
  });

  it("keeps the header return control stable without a save spinner or duplicate keyboard button", () => {
    const screen = readScreen();
    const headerStart = screen.indexOf("<View style={styles.header}");
    const header = screen.slice(
      headerStart,
      screen.indexOf("<KeyboardAvoidingView", headerStart),
    );
    expect(header).toContain("styles.headerBackButton");
    expect(header).toContain('accessibilityLabel="기록 목록으로 돌아가기"');
    expect(header).toContain("styles.headerRight");
    expect(header).toContain("<WritingStateBar");
    expect(header).not.toContain("ActivityIndicator");
    expect(header).not.toContain("keyboard-off-outline");
    expect(screen).toContain("onDismissKeyboard={() =>");
  });

  it("keeps the shared stage menu in a body-colored fixed-height header", () => {
    const screen = readScreen();
    const stylesStart = screen.indexOf("const styles = StyleSheet.create({");
    const stylesSource = screen.slice(stylesStart);
    const stateBar = readFileSync(
      join(appRoot, "components/WritingStateBar/WritingStateBar.tsx"),
      "utf8",
    );
    const memoToolbar = readFileSync(
      join(appRoot, "components/MemoToolbar/MemoToolbar.tsx"),
      "utf8",
    );

    expect(screen).toContain("<View style={styles.header} pointerEvents=\"box-none\">");
    expect(screen).toContain("styles.headerBackButton");
    expect(screen).toContain("styles.headerRight");
    expect(stylesSource).toContain("height: WRITING_HEADER_HEIGHT");
    expect(stylesSource).toContain("backgroundColor: Colors.white");
    expect(stylesSource).not.toContain('position: "absolute",\n    top: 0,\n    left: 0,\n    right: 0,\n    height: WRITING_HEADER_HEIGHT');
    expect(stylesSource).toContain("backgroundColor: \"transparent\",\n    zIndex: 53");
    expect(stateBar).toContain('testID="writing-stage-menu"');
    expect(stateBar).toContain("backgroundColor: Colors.noticeAccent");
    expect(stateBar).toContain("height: 44");
    expect(stateBar).toContain("height: 40");
    expect(stateBar).toContain("<ActionSheetModal");
    expect(stateBar).not.toContain("chevron-down");
    expect(stateBar).not.toContain("@expo/vector-icons");
    const actionSheet = readFileSync(
      join(appRoot, "components/ActionSheetModal/ActionSheetModal.tsx"),
      "utf8",
    );
    expect(actionSheet).toContain("color: Colors.noticeAccent");
    expect(actionSheet).toContain("cancelLabel");
    expect(memoToolbar).toContain("backgroundColor: \"transparent\"");
    expect(screen).toContain("backgroundColor: Colors.white,\n    borderTopWidth");
  });

  it("puts the review actions in the shared menu and removes the floating spell button", () => {
    const screen = readScreen();
    const editorStart = screen.indexOf("<KeyboardAvoidingView");
    const headerAndEditorStart = screen.slice(0, editorStart);

    expect(headerAndEditorStart).not.toContain("styles.toolbar");
    expect(headerAndEditorStart).not.toContain("styles.warningBanner");
    expect(headerAndEditorStart).not.toContain("styles.pageStripWrapper");
    expect(screen).toContain("WebViewMeasureLayer request={warningRequest}");
    expect(screen).toContain("WebViewMeasureLayer request={engineRequest}");
    expect(screen).toContain('label: "자동 분할"');
    expect(screen).toContain('label: "맞춤법 검사"');
    expect(screen).toContain('label: "마감 단계로"');
    expect(screen).not.toContain("spellCheckButtonShadow");
    expect(screen).not.toContain("spellCheckButtonContent");
  });

  it("keeps web overflow highlighting and single-paragraph automatic division active", () => {
    const screen = readScreen();
    const webEditor = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx"),
      "utf8",
    );
    const webOverflow = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/webOverflowHighlight.ts"),
      "utf8",
    );
    const autoSplit = screen.slice(
      screen.indexOf("const handleAutoSplit"),
      screen.indexOf("const handleSplitPage"),
    );

    expect(webEditor).toContain("measureAndHighlightWebOverflow");
    expect(webEditor).toContain("setWebOverflowRanges(editor, ranges)");
    expect(webEditor).toContain(".ProseMirror .overflow-highlight { background: #fecaca; }");
    expect(webOverflow).toContain("view.coordsAtPos(middle).bottom > availableBottom");
    expect(autoSplit).toContain("if (paragraphs.length < 1) continue");
    expect(autoSplit).not.toContain("if (paragraphs.length < 2) continue");
    expect(autoSplit).toContain("splittingRef.current = true");
    expect(autoSplit).toContain("splittingRef.current = false");
  });

  it("guards spell checks against repeated activation and keeps close disabled while loading", () => {
    const screen = readScreen();
    const spellHandler = screen.slice(
      screen.indexOf("const handleRunSpellCheck"),
      screen.indexOf("const handleSpellSkip"),
    );
    const closeHandler = screen.slice(
      screen.indexOf("const handleCloseSpellTab"),
      screen.indexOf("// ── WritingStateBar"),
    );

    expect(screen).toContain("const spellCheckInFlightRef = useRef(false);");
    expect(spellHandler).toContain("if (spellCheckInFlightRef.current) return;");
    expect(spellHandler).toContain("spellCheckInFlightRef.current = true;");
    expect(spellHandler).toContain("spellCheckInFlightRef.current = false;");
    expect(spellHandler).toContain("finally");
    expect(closeHandler).toContain("if (spellCheckInFlightRef.current) return;");
  });

  it("keeps the return lock held until the deferred route dispatch", () => {
    const screen = readScreen();
    const exit = screen.slice(
      screen.indexOf("const exitToPreviousList"),
      screen.indexOf("const handleDraftBack"),
    );
    expect(exit).toContain("isNavigatingRef.current = true");
    expect(exit).not.toContain("isNavigatingRef.current = false");
    expect(exit).not.toContain("setIsNavigating(false)");
  });

  it("replays a completed native removal exactly once instead of scheduling a second back", () => {
    const screen = readScreen();
    const exit = screen.slice(
      screen.indexOf("const exitToPreviousList"),
      screen.indexOf("const handleDraftBack"),
    );
    const removalGuard = screen.slice(
      screen.indexOf("const handlePreventedRemoval"),
      screen.indexOf("const handleDismissKeyboard"),
    );

    expect(screen).toContain("const navigationCommittedRef = useRef(false);");
    expect(exit).toContain("if (navigationCommittedRef.current) return;");
    expect(exit).toContain("if (canPopToList && removalAction) {");
    expect(exit).toContain("navigationCommittedRef.current = true;");
    expect(exit).toContain("navigation.dispatch(removalAction);");
    expect(exit.indexOf("navigation.dispatch(removalAction);")).toBeLessThan(
      exit.indexOf("navigateAfterRemovingGuard("),
    );
    expect(removalGuard).toContain(
      "handlePreventedRemoval = useCallback(({ data }: { data: { action: NavigationAction } })",
    );
    expect(removalGuard).toContain("exitToPreviousList(data.action);");
    expect(removalGuard).toContain("handleHeaderBack(data.action);");
  });

  it("invalidates deferred navigation when the discarded screen unmounts", () => {
    const screen = readScreen();
    const deferredDispatch = screen.slice(
      screen.indexOf("// usePreventRemove updates"),
      screen.indexOf("const handleDismissKeyboard"),
    );

    expect(screen).toContain("navigationSessionRef.current += 1;");
    expect(deferredDispatch).toContain(
      "if (navigationSessionRef.current !== pending.sessionId) return;",
    );
    expect(deferredDispatch).toContain("pendingNavigationRef.current = null;");
  });

  it("uses the same explicit editor bottom padding on web and native", () => {
    const screen = readScreen();
    const webEditor = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditorWeb.tsx"),
      "utf8",
    );
    expect(screen).toContain("contentBottomPadding={WRITING_EDITOR_BOTTOM_PADDING}");
    expect(webEditor).toContain("contentBottomPadding = 120");
    expect(webEditor).toContain('"--content-bottom-padding"');
    expect(webEditor).toContain("padding: 16px 0 var(--content-bottom-padding)");
  });

  it("commits the latest review snapshot before returning to the original thought", () => {
    const screen = readScreen();
    const reverseHandler = screen.slice(
      screen.indexOf("const returnToThoughtMode"),
      screen.indexOf("// ── 분할 → 마감"),
    );

    expect(screen).toContain("useRevertArticleToThought");
    expect(reverseHandler).toContain("if (isNavigatingRef.current) return;");
    expect(reverseHandler).toContain("latestContent = await getEditorContent();");
    expect(reverseHandler).toContain("markDirty(latestTitle, latestContent);");
    expect(reverseHandler).toContain("const flushResult = await flush();");
    expect(reverseHandler.indexOf("await flush()")).toBeLessThan(
      reverseHandler.indexOf("revertArticleToThought.mutateAsync"),
    );
    expect(reverseHandler).toContain("removeRecordFromCache(queryClient, { id: articleId, kind: \"editing\" })");
    expect(reverseHandler).toContain("insertThoughtInRecordCache(queryClient, restoredThought)");
    expect(reverseHandler).toContain("queryClient.setQueryData(getGetThoughtQueryKey(restoredThought.id)");
    expect(reverseHandler).toContain('setModeBoth("draft")');
    expect(reverseHandler).toContain('pathname: "/on-01a"');
    expect(reverseHandler).toContain("id: restoredThought.id");
  });

  it("reaches the idempotent reverse endpoint after a committed response is lost", () => {
    const screen = readScreen();
    const reverseHandler = screen.slice(
      screen.indexOf("const returnToThoughtMode"),
      screen.indexOf("// ── 분할 → 마감"),
    );

    expect(screen).toContain("pendingReverseSnapshotRef");
    expect(reverseHandler).toContain("const canRetryCommittedSnapshot =");
    expect(reverseHandler).toContain("if (!canRetryCommittedSnapshot)");
    expect(reverseHandler).toContain("pendingReverseSnapshotRef.current = {");
    expect(reverseHandler).toContain("restoredThought = await revertArticleToThought.mutateAsync");
    expect(reverseHandler).toContain("pendingReverseSnapshotRef.current = null;");
    expect(reverseHandler.indexOf("if (!canRetryCommittedSnapshot)")).toBeLessThan(
      reverseHandler.indexOf("revertArticleToThought.mutateAsync"),
    );
  });

  it("keeps review content and unlocks retry when reverse-promotion fails", () => {
    const screen = readScreen();
    const reverseHandler = screen.slice(
      screen.indexOf("const returnToThoughtMode"),
      screen.indexOf("// ── 분할 → 마감"),
    );
    expect(reverseHandler).toContain("isNavigatingRef.current = false;");
    expect(reverseHandler).toContain("setIsNavigating(false);");
    expect(reverseHandler).toContain("검토 내용은 그대로 저장되어 있습니다.");
    expect(reverseHandler.indexOf("setModeBoth(\"draft\")")).toBeGreaterThan(
      reverseHandler.indexOf("revertArticleToThought.mutateAsync"),
    );
    expect(screen).toContain('label: "단상 단계로"');
    expect(screen).toContain("onPress: () => void returnToThoughtMode()");
  });
});

describe("on-01a photo removal regression", () => {
  it("does not connect the writing screen to photo creation or retry paths", () => {
    const screen = readScreen();

    expect(screen).not.toContain("onSelectPhoto");
    expect(screen).not.toContain("imagePickerVisible");
    expect(screen).not.toContain("handleInsertImage");
    expect(screen).not.toContain("pickAndUpload");
    expect(screen).not.toContain("ActionSheetModal");
    expect(screen).not.toContain("useImageUpload");
    expect(screen).not.toContain("useInlineImageUpload");
    expect(screen).not.toContain("onImageRetry");
    expect(screen).toContain("onSelectQuote={handleSelectQuoteFromAddMenu}");
  });
});

describe("on-01a keyboard reactivation", () => {
  it("lets the platform editors own reactivation instead of refocusing from the screen container", () => {
    const screen = readScreen();
    const nativeEditorSource = readEditorSource();
    const webEditorSource = readEditorWeb();
    const nativeEditorBundle = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/editorHtml.ts"),
      "utf8",
    );

    expect(screen).not.toContain("handleEditorSurfaceTouch");
    expect(screen).not.toContain("onTouchStart=");
    expect(screen).not.toContain("onTouchMove=");
    expect(screen).not.toContain("onTouchEnd=");

    expect(nativeEditorSource).toContain('document.addEventListener("touchmove"');
    expect(nativeEditorSource).toContain('document.addEventListener("touchcancel"');
    expect(nativeEditorSource).toContain('document.addEventListener("scroll"');
    expect(nativeEditorSource).toContain("isBlankEditorSurfaceTarget(e.target)");
    expect(nativeEditorSource).toContain("isStationaryBlankSurfaceTap(");
    expect(nativeEditorSource).toContain("editor.commands.focus()");
    expect(nativeEditorBundle).toContain("startedOnBlankSurface");
    expect(nativeEditorBundle).toContain('addEventListener("touchcancel"');
    expect(nativeEditorBundle).toContain("3.25.0-");

    expect(webEditorSource).toContain('container.addEventListener("pointerdown"');
    expect(webEditorSource).toContain('container.addEventListener("pointermove"');
    expect(webEditorSource).toContain('container.addEventListener("pointercancel"');
    expect(webEditorSource).toContain('container.addEventListener("scroll"');
    expect(webEditorSource).toContain("isBlankEditorSurfaceTarget(event.target)");
    expect(webEditorSource).toContain("isStationaryBlankSurfaceTap(");
    expect(webEditorSource).toContain("editor.commands.focus()");
  });

  it("accepts only a stationary blank-surface gesture with no scroll", () => {
    const tap = createEditorSurfaceTouchSession(20, 30, true);
    expect(isStationaryBlankSurfaceTap(tap, 24, 35, true)).toBe(true);

    const textTap = createEditorSurfaceTouchSession(20, 30, false);
    expect(isStationaryBlankSurfaceTap(textTap, 20, 30, true)).toBe(false);

    const endedOnControl = createEditorSurfaceTouchSession(20, 30, true);
    expect(isStationaryBlankSurfaceTap(endedOnControl, 20, 30, false)).toBe(false);

    const drag = createEditorSurfaceTouchSession(20, 30, true);
    updateEditorSurfaceTouchSession(drag, 31, 30);
    expect(isStationaryBlankSurfaceTap(drag, 31, 30, true)).toBe(false);

    const scroll = createEditorSurfaceTouchSession(20, 30, true);
    scroll.scrolled = true;
    expect(isStationaryBlankSurfaceTap(scroll, 20, 30, true)).toBe(false);
  });
});

describe("shared title keyboard contract", () => {
  it("distinguishes submit, soft-break, and IME Enter events", () => {
    const plainEnter = {
      key: "Enter",
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
    };

    expect(shouldMoveTitleFocusToBody(plainEnter)).toBe(true);
    expect(shouldMoveTitleFocusToBody({ ...plainEnter, shiftKey: true })).toBe(false);
    expect(shouldMoveTitleFocusToBody({ ...plainEnter, isComposing: true })).toBe(false);
    expect(shouldMoveTitleFocusToBody({ ...plainEnter, keyCode: 229 })).toBe(false);
    expect(shouldMoveTitleFocusToBody(plainEnter, true)).toBe(false);
    expect(
      shouldMoveTitleFocusToBody({ ...plainEnter, key: "a" }),
    ).toBe(false);
  });

  it("commits plain Enter to the body while preserving title soft breaks and IME input", () => {
    const editorWeb = readEditorWeb();
    const editorSource = readEditorSource();
    const editorBundle = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/editorHtml.ts"),
      "utf8",
    );

    expect(editorWeb).toContain("const handleTitleKeyDown");
    expect(editorWeb).toContain("shouldMoveTitleFocusToBody({");
    expect(editorWeb).toContain("shiftKey: e.shiftKey");
    expect(editorWeb).toContain("isComposing: e.nativeEvent.isComposing");
    expect(editorWeb).toContain("keyCode: e.nativeEvent.keyCode");
    expect(editorWeb).toContain('editor.commands.focus("start", { scrollIntoView: false })');
    expect(editorWeb).toContain("onKeyDown={handleTitleKeyDown}");

    expect(editorSource).toContain("let titleComposing = false;");
    expect(editorSource).toContain('titleInput.addEventListener("compositionstart"');
    expect(editorSource).toContain('titleInput.addEventListener("compositionend"');
    expect(editorSource).toContain('titleInput.addEventListener("keydown", handleTitleKeydown)');
    expect(editorSource).toContain(
      "shouldMoveTitleFocusToBody(event, titleComposing)",
    );
    expect(editorSource).toContain("focusEditorStartFromTitle");

    expect(editorBundle).toContain('"compositionstart"');
    expect(editorBundle).toContain('"compositionend"');
    expect(editorBundle).toContain("keyCode!==229");
    expect(editorBundle).toMatch(/addEventListener\("keydown",\w+\)/);
    expect(editorBundle).toContain('focus("start",{scrollIntoView:!1})');
  });

  it("uses an opaque light editor surface and disables native title tap flashes", () => {
    const editorWeb = readEditorWeb();
    const editorNative = readEditorNative();
    const editorBundle = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/editorHtml.ts"),
      "utf8",
    );

    expect(editorWeb).toContain('backgroundColor: "#FFFFFF"');
    expect(editorWeb).toContain('WebkitTapHighlightColor: "transparent"');
    expect(editorNative).toContain('backgroundColor: "#FFFFFF"');
    expect(editorBundle).toContain("background:#fff");
    expect(editorBundle).toContain("-webkit-tap-highlight-color:transparent");
  });

  it("round-trips multi-line titles without normalizing their line breaks", () => {
    const screen = readScreen();
    const editorWeb = readEditorWeb();
    const editorSource = readEditorSource();
    const titleHandler = screen.slice(
      screen.indexOf("const handleTitleChange"),
      screen.indexOf("// ── 분할 측정/검증"),
    );
    const restoreHandler = screen.slice(
      screen.indexOf("const handleAutosaveRestore"),
      screen.indexOf("const {", screen.indexOf("const handleAutosaveRestore")),
    );

    expect(titleHandler).toContain("setTitle(text)");
    expect(titleHandler).toContain("titleRef.current = text");
    expect(titleHandler).toContain("markTitleDirty(text, contentRef.current)");
    expect(titleHandler).not.toContain(".trim()");
    expect(titleHandler).not.toContain(".replace(");
    expect(restoreHandler).toContain("setTitle(data.title)");
    expect(restoreHandler).toContain("editorRef.current?.setTitle(data.title)");
    expect(editorWeb).toContain("titleRef.current.value = title");
    expect(editorSource).toContain("titleInput.value = cmd.title ||");
    expect(editorSource).toContain("autoResizeTitle()");
  });
});