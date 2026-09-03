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