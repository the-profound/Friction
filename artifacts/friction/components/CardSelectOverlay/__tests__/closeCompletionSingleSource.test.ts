import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const overlayPath = join(__dirname, "../CardSelectOverlay.tsx");
const read = () => readFileSync(overlayPath, "utf8");

const extractBlock = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("runCloseRef completion has a single source of truth (progress), not swipeY", () => {
  it("swipeY's withTiming in the close routine carries no completion callback", () => {
    const overlay = read();
    const runClose = extractBlock(
      overlay,
      "runCloseRef.current = () => {",
      "// Non-drag close triggers (backdrop tap, hardware back",
    );

    // Reanimated's valueSetter short-circuits withTiming(target, ...) and
    // fires its callback synchronously -- before any frame runs -- whenever
    // the shared value already equals that target. swipeY is already 0 on
    // every non-drag close trigger (backdrop tap, hardware back, info-bar
    // nav), so a completion callback attached here fires immediately and
    // unmounts the Modal before progress's real shrink-back has rendered a
    // single frame. It must stay a bare value assignment with no callback.
    expect(runClose).toContain(
      "swipeY.value = withTiming(0, {\n      duration: closeDuration,\n      easing: REANIMATED_TRANSITION_EASING,\n    });",
    );
    expect(runClose).not.toMatch(/swipeY\.value = withTiming\(\s*0,\s*\{[^}]*\},\s*\(finished\)/s);
  });

  it("progress's withTiming completion is the sole trigger for finishCloseWithIndex", () => {
    const overlay = read();
    const runClose = extractBlock(
      overlay,
      "runCloseRef.current = () => {",
      "// Non-drag close triggers (backdrop tap, hardware back",
    );

    // progress always starts at ~1 (fully open) and targets 0, so unlike
    // swipeY it never short-circuits -- it is safe to be the only path that
    // unmounts the overlay.
    expect(runClose).toMatch(
      /progress\.value = withTiming\(\s*0,\s*\{[^}]*\},\s*\(finished\) => \{\s*if \(finished\) runOnJS\(finishCloseWithIndex\)\(initIdx\);\s*\},\s*\);/s,
    );
    // finishClose itself must no longer be wired directly to any animation
    // callback -- only reachable via finishCloseWithIndex or the fallback
    // timer.
    expect(runClose).not.toContain("runOnJS(finishClose)()");
  });

  it("a fresh open resets the stale verticalDismissActiveRef from a prior swipe-close session", () => {
    const overlay = read();
    const openBranch = extractBlock(
      overlay,
      "useEffect(() => {\n    if (isOpen) {",
      "} else {\n      openedRef.current = false;",
    );

    // verticalDismissActiveRef is only ever reset to false by a gesture's
    // onBegin or by restoreDetailsAfterDismiss on a cancelled drag -- never
    // by a completed swipe-close. Left stale `true` across sessions, the
    // next session's non-drag close would wrongly skip requestClose's
    // instant details-hide and reintroduce the original cross-fade stutter.
    expect(openBranch).toContain("verticalDismissActiveRef.current = false;");
  });
});
