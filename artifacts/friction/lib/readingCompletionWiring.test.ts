import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldSyncSpaceInboxRead } from "./spaceInboxReadSync";

const readScreenPath = fileURLToPath(new URL("../app/read.tsx", import.meta.url));
const readScreen = readFileSync(readScreenPath, "utf8");
const readingSessionPath = fileURLToPath(new URL("./useReadingSession.ts", import.meta.url));
const readingSession = readFileSync(readingSessionPath, "utf8");
const tokensPath = fileURLToPath(new URL("../constants/tokens.ts", import.meta.url));
const tokens = readFileSync(tokensPath, "utf8");
const spaceDetailPath = fileURLToPath(new URL("../app/of-space-detail.tsx", import.meta.url));
const spaceDetail = readFileSync(spaceDetailPath, "utf8");

function sourceBetween(start: string, end: string): string {
  const startIndex = readScreen.indexOf(start);
  const endIndex = readScreen.indexOf(end, startIndex);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return readScreen.slice(startIndex, endIndex);
}

describe("rereceived inbox completion wiring", () => {
  it("routes inbox rereads through the shared completion commit", () => {
    const handler = sourceBetween(
      "const handleRereadExit = useCallback",
      "const handleTextSelect = useCallback",
    );

    expect(handler).toContain("shouldCommitCompletionForEntry(mode, inboxId)");
    expect(handler).toContain("handleCommitAndSkip()");
    expect(readScreen).toContain(
      'onSkip={mode === "re_read" ? handleRereadExit : handleCommitAndSkip}',
    );
  });

  it("keeps current-delivery invalidation and duplicate follow-up in the shared commit", () => {
    const handler = sourceBetween(
      "const handleCommitAndSkip = useCallback",
      "const handleRereadExit = useCallback",
    );

    expect(handler).toContain("const result = await reading.commitCompletion()");
    expect(handler).toContain("invalidateInbox(queryClient)");
    expect(handler).toContain("promptOrContinue(navigateBackImmediately)");
  });

  it("navigates non-inbox rereads immediately and saves answers in the background", () => {
    const handler = sourceBetween(
      "const handleRereadExit = useCallback",
      "const handleTextSelect = useCallback",
    );

    expect(handler).toContain("launchCompletionAction({");
    expect(handler).toContain("onStart: navigateBackImmediately");
    expect(handler).toContain("await applyAnsweredQuestionCardsToMemo()");
    expect(handler).not.toContain("withTiming(");
  });
});

describe("space letter inbox synchronization", () => {
  it("marks every unread inbox copy after a primary space read completes", () => {
    expect(spaceDetail).toContain('params: { articleId: article.id, entrySource: "space" }');
    expect(spaceDetail).toContain('params: { articleId: article.id, mode: "re_read" }');

    const sync = sourceBetween(
      "const syncSpaceInboxRead = useCallback",
      "// ── Analytics tracking refs",
    );
    expect(sync).toContain("shouldSyncSpaceInboxRead({ entrySource, mode, userId, articleId })");
    expect(sync).toContain("params: { recipientId: userId }");
    expect(sync).not.toContain("exceptInboxId");
    expect(sync).toContain("invalidateInbox(queryClient)");
    expect(sync).toContain("failed (non-fatal)");
  });

  it("preserves the space origin across active-reading persistence and restoration", () => {
    expect(readScreen).toContain("analyticsSessionId: analyticsSessionIdRef.current");
    expect(readScreen).toContain("analyticsIsReread: isAnalyticsReread");
    const rootLayout = readFileSync(
      fileURLToPath(new URL("../app/_layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(rootLayout).toContain("entrySource: readingToRestore.entrySource");
    expect(rootLayout).toContain(
      "readingQuestionSessionId: readingToRestore.readingQuestionSessionId",
    );

    const restoredSession = {
      userId: "current-user",
      articleId: "space-article",
      mode: "basic" as const,
      entrySource: "space" as const,
    };
    expect(shouldSyncSpaceInboxRead(restoredSession)).toBe(true);
    expect(shouldSyncSpaceInboxRead({ ...restoredSession, mode: "re_read" })).toBe(false);
    expect(shouldSyncSpaceInboxRead({ ...restoredSession, entrySource: "list" })).toBe(false);
  });

  it("runs synchronization only after successful completion in save and skip flows", () => {
    const save = sourceBetween(
      "const handleCommitAndSave = useCallback",
      "const handleCommitAndSkip = useCallback",
    );
    const skip = sourceBetween(
      "const handleCommitAndSkip = useCallback",
      "const handleRereadExit = useCallback",
    );

    for (const handler of [save, skip]) {
      expect(handler.indexOf("await reading.commitCompletion()")).toBeGreaterThanOrEqual(0);
      expect(handler.indexOf("await syncSpaceInboxRead()")).toBeGreaterThan(
        handler.indexOf("if (!result.success)"),
      );
    }
  });
});

describe("safe reading exit navigation", () => {
  it("returns to the previous screen when possible and falls back to records", () => {
    const navigation = sourceBetween(
      "const navigateBackDelayed = useCallback",
      "const handleBack = useCallback",
    );

    expect(navigation).toContain("setTimeout(() => {");
    expect(navigation).toContain("if (router.canGoBack())");
    expect(navigation).toContain("router.back()");
    expect(navigation).toContain('router.replace("/(tabs)/on")');
  });

  it("keeps ordinary back navigation delayed but completion exits immediate", () => {
    const generalExit = sourceBetween(
      "const handleBack = useCallback",
      "useEffect(() => {",
    );
    const saveExit = sourceBetween(
      "const handleCommitAndSave = useCallback",
      "const handleCommitAndSkip = useCallback",
    );
    const completionExit = sourceBetween(
      "const handleCommitAndSkip = useCallback",
      "const handleRereadExit = useCallback",
    );
    const rereadExit = sourceBetween(
      "const handleRereadExit = useCallback",
      "const handleTextSelect = useCallback",
    );

    expect(generalExit).toContain("runOnJS(navigateBackDelayed)()");
    for (const handler of [completionExit, rereadExit]) {
      expect(handler).toContain("navigateBackImmediately");
      expect(handler).not.toContain("runOnJS(navigateBackDelayed)()");
      expect(handler).not.toContain("withTiming(");
    }
    expect(saveExit).not.toContain("runOnJS(navigateBackDelayed)()");
  });
});

describe("in-screen reread reset wiring", () => {
  it("restarts the reading session at the cover and retires the completed pager", () => {
    const handler = sourceBetween(
      "const handleRestartReading = useCallback",
      "const finishPageTurnRef = useRef",
    );

    expect(handler).toContain("pageTurnGenerationRef.current += 1");
    expect(handler).toContain("isCommittingRef.current = false");
    expect(handler).toContain("activeSwipeRef.current = null");
    expect(handler).toContain("setCompleteScreenVisible(false)");
    expect(handler).toContain("setIsInScreenReread(true)");
    expect(handler).toContain("reading.restartReading()");
    expect(handler).toContain("analyticsSessionIdRef.current = createAnalyticsSessionId()");
    expect(handler).toContain("resetReadingQuestionSession(nextReadingQuestionSessionId)");
    expect(handler).toContain("readingQuestionSessionId: nextReadingQuestionSessionId");
    expect(handler).toContain("hasTrackedReadingStartRef.current = false");
    expect(readScreen).toContain("onReread={handleRestartReading}");
  });

  it("shows an exiting back button throughout rereads without changing basic first-read behavior", () => {
    expect(readScreen).toContain(
      'const isRereadUI = mode === "re_read" || isInScreenReread',
    );
    expect(readScreen).toContain(
      "const showFloatingBackButton = isOnLastLetterPage || isRereadUI",
    );
    expect(readScreen).toContain(
      'pointerEvents={showFloatingBackButton ? "auto" : "none"}',
    );

    const handler = sourceBetween(
      "const handleFloatingBackBtn = useCallback",
      "const snapConfig =",
    );
    expect(handler).toContain(
      'if (!isRereadUI && reading.session.state === "READING" && isOnLastLetterPage)',
    );
    expect(handler).toContain("triggerProgrammaticForwardRef.current()");
    expect(handler).toContain("handleBack()");
  });
});

describe("reading funnel analytics wiring", () => {
  it("uses one persisted analytics session for start, resume, completion, and action", () => {
    expect(readScreen).toContain("analyticsSessionId: analyticsSessionIdRef.current");
    expect(readScreen).toContain("trackReadingStart({");
    expect(readScreen).toContain("trackReadingResume({");
    expect(readScreen).toContain("trackReadingComplete({");
    expect(readScreen).toContain("trackArticleAction({");
  });

  it("tracks reading memos only from the successful creation callback", () => {
    const selectionHandler = sourceBetween(
      "const handleMemoSentence = useCallback",
      "const dynamicStyles = useMemo",
    );
    expect(selectionHandler).not.toContain("trackMemoCreatedDuringReading");
    expect(readScreen).toContain("onReadingThoughtCreated={(thought, content) => {");
    expect(readScreen).toContain("memoLength: getReadingThoughtMemoLength(content)");
  });
});

describe("non-blocking completion save", () => {
  it("tracks active question exposure, first input, and per-item save outcomes without content", () => {
    expect(readScreen).toContain("visualPageRef.current !== totalPagesRef.current");
    expect(readScreen).toContain("trackReadingQuestionSessionExposed");
    expect(readScreen).toContain("trackReadingQuestionItemExposed");
    expect(readScreen).toContain("trackReadingQuestionAnswerStarted");
    expect(readScreen).toContain("saveReadingQuestionAnswers({");
    expect(readScreen).toContain("clientId,");
    expect(readScreen).toContain("readingQuestionSessionId: questionAnswerSessionKey");
    expect(readScreen).toContain(
      "mode, questionAnswerSessionKey, setActiveSession, userId",
    );
    expect(readScreen).toContain("params.readingQuestionSessionId || createReadingQuestionSessionId(articleId)");
    expect(readScreen).toContain("trackReadingQuestionSaveSucceeded");
    expect(readScreen).toContain("thoughtId: thought.id");
    expect(readScreen).toContain("answerLength: readingQuestionAnswerLength(card.answer)");
    expect(readScreen).toContain("trackReadingQuestionSaveFailed");
    expect(readScreen).not.toMatch(/trackReadingQuestion\w+\(\{[\s\S]{0,300}(?:question|answer):/);
  });

  it("starts archive persistence in the background and keeps the completion screen open", () => {
    const handler = sourceBetween(
      "const handleCommitAndSave = useCallback",
      "const handleCommitAndSkip = useCallback",
    );

    expect(handler).toContain("launchCompletionAction({");
    expect(handler).toContain("lock: completionActionRef");
    expect(handler).toContain("await reading.commitCompletion()");
    expect(handler).toContain("invalidateInbox(queryClient)");
    expect(handler).toContain("invalidateMyCollections(queryClient)");
    expect(handler).toContain("invalidateRecentCollection(queryClient, userId)");
    expect(handler).toContain("background save failed");
    expect(handler.indexOf("setIsSavedThisSession(true)")).toBeLessThan(
      handler.indexOf("await reading.commitCompletion()"),
    );
    expect(handler).toContain("setIsSavedThisSession(false)");
    expect(handler).toContain("setArchiveError(`${message} 보관하기를 눌러 다시 시도해주세요.`)");
    expect(handler).toContain("recent collection update failed (non-fatal)");

    const backgroundStart = handler.indexOf("work: async () => {");
    const navigationStart = handler.indexOf("trackArticleAction({");
    expect(backgroundStart).toBeGreaterThanOrEqual(0);
    expect(navigationStart).toBeGreaterThan(backgroundStart);
    expect(handler).toContain("setIsSavedThisSession(true)");
    const archiveTail = handler.slice(navigationStart, handler.indexOf("const handleStartReply"));
    expect(archiveTail).not.toContain("clearActiveSession()");
    expect(archiveTail).not.toContain("overlayOpacity.value = withTiming(1");
  });

  it("keeps reread and exit available while archive persistence settles", () => {
    const screen = sourceBetween(
      "function ReadingCompleteScreen({",
      "const readingCompleteStyles = StyleSheet.create",
    );
    const restart = sourceBetween(
      "const handleRestartReading = useCallback",
      "const finishPageTurnRef = useRef",
    );
    const exit = sourceBetween(
      "const handleCommitAndSkip = useCallback",
      "const handleRereadExit = useCallback",
    );

    expect(screen).toContain("const isNavigationBlocked = isActionBusy && !isSaving");
    expect(screen).toContain("disabled={isNavigationBlocked}");
    expect(restart).toContain('completionActionRef.current !== "save"');
    expect(exit).toContain('completionActionRef.current === "save"');
    expect(exit.indexOf("clearActiveSession()")).toBeLessThan(
      exit.indexOf("promptOrContinue(navigateBackImmediately)"),
    );
    expect(exit).toContain("promptOrContinue(navigateBackImmediately)");
  });

  it("patches the inbox before completion network work and restores it on failure", () => {
    const commitStart = readingSession.indexOf("const commitCompletion = useCallback");
    const commitEnd = readingSession.indexOf("const restartReading = useCallback", commitStart);
    const commit = readingSession.slice(commitStart, commitEnd);

    expect(commit.indexOf("patchInboxItemInCache(queryClient, inboxId")).toBeLessThan(
      commit.indexOf("await createArticleRead.mutateAsync"),
    );
    expect(commit).toContain("queryClient.getQueriesData({ queryKey: getListInboxQueryKey() })");
    expect(commit).toContain("queryClient.setQueryData(queryKey, snapshot)");
  });

  it("navigates to reply before completion persistence and keeps one guarded background attempt", () => {
    const handler = sourceBetween(
      "const handleStartReply = useCallback",
      "const handleCommitAndSkip = useCallback",
    );

    expect(handler).toContain("if (!canStartReply || !inboxId) return");
    expect(handler).toContain("const replySourceArticleId = articleId");
    expect(handler).toContain("const replyTargetInboxId = inboxId");
    expect(handler).toContain("router.push({");
    expect(handler).toContain("launchCompletionAction({");
    expect(handler).toContain("lock: completionActionRef");
    expect(handler.indexOf("router.push({")).toBeLessThan(
      handler.indexOf("await reading.commitCompletion()"),
    );
    expect(handler).toContain("await applyAnsweredQuestionCardsToMemo()");
    expect(handler).toContain("await syncSpaceInboxRead()");
    expect(handler).toContain("invalidateInbox(queryClient)");
    expect(handler).toContain("onSuccess: clearActiveSession");
    expect(handler.indexOf("onSuccess: clearActiveSession")).toBeGreaterThan(
      handler.indexOf("await syncSpaceInboxRead()"),
    );
    expect(handler.slice(0, handler.indexOf("work: async () => {"))).not.toContain(
      "clearActiveSession()",
    );
    expect(handler).toContain("background completion failed");
  });

  it("switches one stable action slot from archive to reread and keeps exit last", () => {
    const screen = sourceBetween(
      "function ReadingCompleteScreen({",
      "const readingCompleteStyles = StyleSheet.create",
    );

    expect(screen).toContain("{isAlreadySaved ? (");
    expect(screen).toContain("disabled={isActionBusy || !isCollectionsReady}");
    expect(screen).toContain('accessibilityState={{ disabled: isActionBusy || !isCollectionsReady, busy: isSaving }}');
    expect(screen).toContain('accessibilityRole="alert"');
    expect(screen).toContain('testID="reading-complete-save-error"');
    expect(screen).not.toContain('isAlreadySaved ? "보관됨"');

    const reread = screen.indexOf('accessibilityLabel="다시 읽기"');
    const save = screen.indexOf('accessibilityLabel="보관하기"');
    const exit = screen.indexOf('accessibilityLabel="나가기"');
    expect(reread).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThanOrEqual(0);
    expect(exit).toBeGreaterThan(reread);
    expect(exit).toBeGreaterThan(save);
    expect(screen.match(/testID="reading-complete-(?:reread|save)"/g)).toHaveLength(2);
  });

  it("uses stable full-width button dimensions and brand action colors", () => {
    const styles = sourceBetween(
      "const readingCompleteStyles = StyleSheet.create",
      "\n});",
    );

    expect(styles).toMatch(/actionShadow:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.white[\s\S]*?\.\.\.Shadows\.readingCompletionAction/);
    expect(styles).toMatch(/saveBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.noticeAccentSoft/);
    expect(styles).toMatch(/saveBtnText:\s*\{[\s\S]*?color:\s*Colors\.primaryAction/);
    expect(readScreen).toContain("<Text style={readingCompleteStyles.saveBtnText}>다시 읽기</Text>");
    expect(styles).toMatch(/skipBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.white/);
    expect(styles).toMatch(/skipBtnText:\s*\{[\s\S]*?color:\s*Colors\.black/);
    expect(styles).not.toMatch(/(?:saveBtn|skipBtn):\s*\{[\s\S]*?border(?:Width|Color):/);
  });

  it("keeps shadow ownership on an opaque outer surface", () => {
    const screen = sourceBetween(
      "function ReadingCompleteScreen({",
      "const readingCompleteStyles = StyleSheet.create",
    );

    expect(screen.match(/style=\{readingCompleteStyles\.actionShadow\}/g)).toBeNull();
    expect(screen.match(/style=\{\[readingCompleteStyles\.actionShadow,/g)).toHaveLength(4);
    expect(screen).toContain("<View style={readingCompleteStyles.replyBtn}>");
    expect(screen.match(/<View style=\{readingCompleteStyles\.saveBtn\}>/g)).toHaveLength(2);
    expect(screen).toContain("<View style={readingCompleteStyles.skipBtn}>");
  });

  it("defines the completion action shadow for iOS, Android, and web", () => {
    const shadow = tokens.slice(
      tokens.indexOf("readingCompletionAction: Platform.select"),
      tokens.indexOf("/** One raised-surface treatment", tokens.indexOf("readingCompletionAction: Platform.select")),
    );

    expect(shadow).toContain("ios:");
    expect(shadow).toContain('shadowColor: "#000"');
    expect(shadow).toContain("shadowOpacity: 0.12");
    expect(shadow).toContain("android:");
    expect(shadow).toContain("elevation: 3");
    expect(shadow).toContain("web:");
    expect(shadow).toContain('boxShadow: "0px 2px 8px rgba(0,0,0,0.12)"');
    expect(shadow).toContain("default: {}");
  });

  it("keeps disabled styling layout-neutral", () => {
    const styles = sourceBetween(
      "const readingCompleteStyles = StyleSheet.create",
      "\n});",
    );
    const disabled = styles.slice(styles.indexOf("btnDisabled:"));

    expect(disabled).toContain("opacity: 0.5");
    expect(disabled).not.toMatch(/(?:width|height|margin|padding|border|elevation|shadow|boxShadow)\s*:/);
  });
});
