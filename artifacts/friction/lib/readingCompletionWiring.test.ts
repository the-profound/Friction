import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const readScreenPath = fileURLToPath(new URL("../app/read.tsx", import.meta.url));
const readScreen = readFileSync(readScreenPath, "utf8");

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

    expect(styles).toMatch(/rereadBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.primaryAction/);
    expect(styles).toMatch(/rereadBtnText:\s*\{[\s\S]*?color:\s*Colors\.primaryActionForeground/);
    expect(styles).toMatch(/saveBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?backgroundColor:\s*Colors\.noticeAccentSoft[\s\S]*?borderWidth:\s*1\.5[\s\S]*?borderColor:\s*Colors\.primaryAction/);
    expect(styles).toMatch(/saveBtnText:\s*\{[\s\S]*?color:\s*Colors\.primaryAction/);
    expect(styles).toMatch(/skipBtn:\s*\{[\s\S]*?width:\s*"100%"[\s\S]*?height:\s*52[\s\S]*?borderWidth:\s*1\.5[\s\S]*?borderColor:\s*Colors\.black/);
    expect(styles).toMatch(/skipBtnText:\s*\{[\s\S]*?color:\s*Colors\.black/);
    expect(styles).not.toMatch(/(?:saveBtn|skipBtn):\s*\{[\s\S]*?overflow:\s*"hidden"/);
  });
});
