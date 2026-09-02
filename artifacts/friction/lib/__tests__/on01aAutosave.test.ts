import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
    expect(removalGuard).toContain("handleHeaderBack();");
    const backHandler = screen.slice(
      screen.indexOf("const handleDraftBack"),
      screen.indexOf("// Native lifecycle events"),
    );
    expect(backHandler).toContain("await persistLatestAutosave();");
    expect(backHandler).toContain("void flush().then");
    expect(backHandler.indexOf("await persistLatestAutosave();")).toBeLessThan(
      backHandler.indexOf("exitToPreviousList();", backHandler.indexOf("await persistLatestAutosave();")),
    );
    expect(backHandler).not.toContain("await flush()");
    expect(screen).toContain("<Stack.Screen options={{ gestureEnabled: true }} />");
  });

  it("keeps the header return control stable without a save spinner or duplicate keyboard button", () => {
    const screen = readScreen();
    const header = screen.slice(
      screen.indexOf('<View style={styles.header}>'),
      screen.indexOf("{isDividing &&", screen.indexOf('<View style={styles.header}>')),
    );
    expect(header).toContain("styles.headerBackButton");
    expect(header).toContain('accessibilityLabel="기록 목록으로 돌아가기"');
    expect(header).toContain("styles.headerStateBar");
    expect(header).not.toContain("ActivityIndicator");
    expect(header).not.toContain("keyboard-off-outline");
    expect(screen).toContain("onDismissKeyboard={() =>");
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
  it("focuses the editor from blank writing-surface taps without treating a drag as a tap", () => {
    const screen = readScreen();
    const nativeEditorSource = readEditorSource();

    expect(screen).toContain("onTouchStart={handleEditorSurfaceTouchStart}");
    expect(screen).toContain("onTouchMove={handleEditorSurfaceTouchMove}");
    expect(screen).toContain("onTouchEnd={handleEditorSurfaceTouch}");
    expect(screen).toContain("editorSurfaceTouchMovedRef.current");
    expect(screen).toContain("selectionState.activeBlock === \"horizontalRule\"");
    expect(screen).toContain("editorRef.current?.focus()");

    expect(nativeEditorSource).toContain("const SURFACE_TAP_THRESHOLD = 10");
    expect(nativeEditorSource).toContain("if (keyboardOpen || !editor || editor.isDestroyed) return");
    expect(nativeEditorSource).toContain("dx >= SURFACE_TAP_THRESHOLD || dy >= SURFACE_TAP_THRESHOLD");
    expect(nativeEditorSource).toContain("#title-input, #source-article-slot, .hr-wrapper");
    expect(nativeEditorSource).toContain("editor.commands.focus()");
  });
});