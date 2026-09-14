import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { shouldSyncSpaceInboxRead } from "./spaceInboxReadSync";

const readScreenPath = fileURLToPath(new URL("../app/read.tsx", import.meta.url));
const readScreen = readFileSync(readScreenPath, "utf8");
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
    expect(handler).toContain("await handleCommitAndSkip()");
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
    expect(handler).toContain("promptOrContinue(() => {");
  });

  it("keeps non-inbox rereads on the existing fade-only exit", () => {
    const handler = sourceBetween(
      "const handleRereadExit = useCallback",
      "const handleTextSelect = useCallback",
    );

    expect(handler).toContain("applyAnsweredQuestionCardsToMemo()");
    expect(handler).toContain("overlayOpacity.value = withTiming(1");
    expect(handler).toContain("runOnJS(navigateBackDelayed)()");
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
    expect(readScreen).toContain(
      "setActiveSession({ articleId, inboxId, entrySource, mode, userId })",
    );
    const rootLayout = readFileSync(
      fileURLToPath(new URL("../app/_layout.tsx", import.meta.url)),
      "utf8",
    );
    expect(rootLayout).toContain("entrySource: readingToRestore.entrySource");

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

  it("keeps every delayed reading exit on the shared safe path", () => {
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

    for (const handler of [generalExit, saveExit, completionExit, rereadExit]) {
      expect(handler).toContain("runOnJS(navigateBackDelayed)()");
    }
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

describe("non-blocking completion save", () => {
  it("starts persistence in the background and navigates without awaiting it", () => {
    const handler = sourceBetween(
      "const handleCommitAndSave = useCallback",
      "const handleCommitAndSkip = useCallback",
    );

    expect(handler).toContain("if (isSavingRef.current) return");
    expect(handler).toContain("void (async () => {");
    expect(handler).toContain("await reading.commitCompletion()");
    expect(handler).toContain("invalidateInbox(queryClient)");
    expect(handler).toContain("invalidateMyCollections(queryClient)");
    expect(handler).toContain("invalidateRecentCollection(queryClient, userId)");
    expect(handler).toContain("background save failed");

    const backgroundStart = handler.indexOf("void (async () => {");
    const navigationStart = handler.indexOf('trackArticleAction({ articleId, action: "save"');
    expect(backgroundStart).toBeGreaterThanOrEqual(0);
    expect(navigationStart).toBeGreaterThan(backgroundStart);
    expect(handler.slice(navigationStart)).toContain("clearActiveSession()");
    expect(handler.slice(navigationStart)).toContain("overlayOpacity.value = withTiming(1");
  });

  it("keeps safe unavailable states and the requested action order", () => {
    const screen = sourceBetween(
      "function ReadingCompleteScreen({",
      "const readingCompleteStyles = StyleSheet.create",
    );

    expect(screen).toContain("disabled={isSaving || !isCollectionsReady || isAlreadySaved}");
    expect(screen).toContain('accessibilityState={{ disabled: isSaving || !isCollectionsReady || isAlreadySaved, busy: isSaving }}');

    const reread = screen.indexOf('accessibilityLabel="다시 읽기"');
    const save = screen.indexOf('accessibilityLabel="보관하기"');
    const exit = screen.indexOf('accessibilityLabel="나가기"');
    expect(reread).toBeGreaterThanOrEqual(0);
    expect(save).toBeGreaterThan(reread);
    expect(exit).toBeGreaterThan(save);
  });

  it("uses stable full-width button dimensions and brand action colors", () => {
    const styles = sourceBetween(
      "const readingCompleteStyles = StyleSheet.create",
      "\n});",
    );

    expect(styles).toMatch(/actionShadow:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.white[\s\S]*?\.\.\.Shadows\.readingCompletionAction/);
    expect(styles).toMatch(/rereadBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.primaryAction/);
    expect(styles).toMatch(/rereadBtnText:\s*\{[\s\S]*?color:\s*Colors\.primaryActionForeground/);
    expect(styles).toMatch(/saveBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.noticeAccentSoft/);
    expect(styles).toMatch(/saveBtnText:\s*\{[\s\S]*?color:\s*Colors\.primaryAction/);
    expect(styles).toMatch(/skipBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.white/);
    expect(styles).toMatch(/skipBtnText:\s*\{[\s\S]*?color:\s*Colors\.black/);
    expect(styles).not.toMatch(/(?:rereadBtn|saveBtn|skipBtn):\s*\{[\s\S]*?border(?:Width|Color):/);
  });

  it("keeps shadow ownership on an opaque outer surface", () => {
    const screen = sourceBetween(
      "function ReadingCompleteScreen({",
      "const readingCompleteStyles = StyleSheet.create",
    );

    expect(screen.match(/style=\{readingCompleteStyles\.actionShadow\}/g)).toHaveLength(1);
    expect(screen.match(/style=\{\[readingCompleteStyles\.actionShadow,/g)).toHaveLength(2);
    expect(screen).toContain("<View style={readingCompleteStyles.rereadBtn}>");
    expect(screen).toContain("<View style={readingCompleteStyles.saveBtn}>");
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
