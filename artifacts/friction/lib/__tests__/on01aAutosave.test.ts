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
});

describe("on-01a latest-snapshot autosave boundary", () => {
  it("uses collision-free request ids for overlapping WebView exports", () => {
    const screen = readScreen();

    expect(screen).toContain("const exportRequestSeqRef = useRef(0);");
    expect(screen).toContain("exportRequestSeqRef.current += 1;");
    expect(screen).toContain('nextExportRequestId("export")');
    expect(screen).toContain('nextExportRequestId("autosave")');
  });

  it("flushes the same latest editor snapshot on back, keyboard close, app background, and retry", () => {
    const screen = readScreen();
    const latestFlush = screen.slice(
      screen.indexOf("const flushLatestEditorSnapshot"),
      screen.indexOf("const handleRetryAutosave"),
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

    expect(latestFlush).toContain("const latest = await getEditorContent();");
    expect(latestFlush).toContain("markDirty(isThoughtModeRef.current ? \"\" : titleRef.current, latest);");
    expect(latestFlush).toContain("const result = await flush();");
    expect(backHandler).toContain("await flushLatestEditorSnapshot()");
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
      screen.indexOf("const handleRetryAutosave"),
    );

    expect(latestFlush).toContain("isMeaningfulThoughtMarkdown(latest)");
    expect(latestFlush).toContain("discardAutosave();");
    expect(latestFlush).toContain("meaningful: false");
  });

  it("shows pending, saving, saved, and retryable error states in-screen", () => {
    const screen = readScreen();

    expect(screen).toContain("autoSaveStatus === \"error\"");
    expect(screen).toContain("저장 대기 중");
    expect(screen).toContain("저장 중…");
    expect(screen).toContain("저장됨");
    expect(screen).toContain("저장 실패");
    expect(screen).toContain("onPress={handleRetryAutosave}");
    expect(screen).toContain('accessibilityLabel="단상 저장 다시 시도"');
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
    expect(autoSave).toContain("await queueWriteRef.current;");
    expect(autoSave.indexOf("await queueWriteRef.current;")).toBeLessThan(
      autoSave.indexOf("await onSaveRef.current(data);"),
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

    expect(flushBody).toContain("await activeSaveRef.current;");
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
      "return { status, isDirty, markDirty, markTitleDirty, flush, retry, discard, bindEntity };",
    );
  });
});

describe("WebView editor autosave signals", () => {
  it("does not suppress native Korean IME or formatting changes with unchanged metrics", () => {
    const editorSource = readEditorSource();

    expect(editorSource).toContain("Korean IME composition and formatting changes");
    expect(editorSource).not.toContain("charCount === lastEmittedCharCount");
    expect(editorSource).toContain(
      'postToRN({ type: "onChange", payload: { isDirty: true, charCount, wordCount } });',
    );
  });

  it("keeps the web editor's debounced document-change signal", () => {
    const editorWeb = readEditorWeb();

    expect(editorWeb).toContain("onUpdate: ({ editor: ed }) => {");
    expect(editorWeb).toContain("onChange?.(payload);");
    expect(editorWeb).not.toContain("lastEmittedCharCount");
  });
});

describe("on-01a guarded return navigation", () => {
  it("pops to the tab list and routes native/browser back through the save guard", () => {
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
    expect(screen).toContain("<Stack.Screen options={{ gestureEnabled: true }} />");
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