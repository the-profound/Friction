import { describe, expect, it } from "vitest";
import {
  advancePage,
  clampReadingPage,
  createInitialSession,
  getProgress,
  getVisualReadingPage,
  goToPreviousPage,
  isCurrentReadingPagerTransition,
  isLastPage,
  entersReaderSuspension,
  resumesReaderFromSuspension,
  getCompletionCommitDisposition,
  transitionSession,
} from "./readingPersistence";

describe("reader virtual-page bounds", () => {
  it("keeps stale session pages within the letter-plus-question range", () => {
    expect(clampReadingPage(-4, 3)).toBe(0);
    expect(clampReadingPage(99, 3)).toBe(3);
    expect(clampReadingPage(Number.NaN, 3)).toBe(0);
    expect(clampReadingPage(2.8, 3)).toBe(2);
  });

  it("keeps the completion screen as the only page after the question card", () => {
    expect(getVisualReadingPage(-1, 3, false)).toBe(0);
    expect(getVisualReadingPage(99, 3, false)).toBe(3);
    expect(getVisualReadingPage(1, 3, true)).toBe(4);
    expect(getVisualReadingPage(1, 0, true)).toBe(0);
  });

  it("normalizes corrupted positions while moving at either end", () => {
    const tooFarForward = createInitialSession("article", "basic", 3, {
      currentPage: 99,
      scrollPosition: 0,
    });
    expect(tooFarForward.position.currentPage).toBe(3);
    expect(goToPreviousPage(tooFarForward).position.currentPage).toBe(2);

    const tooFarBackward = {
      ...tooFarForward,
      position: { ...tooFarForward.position, currentPage: -4 },
    };
    expect(advancePage(tooFarBackward).position.currentPage).toBe(1);
  });

  it("starts rereads at the cover even when a saved position is supplied", () => {
    const reread = createInitialSession("article", "re_read", 3, {
      currentPage: 2,
      scrollPosition: 180,
    });
    expect(reread.position.currentPage).toBe(0);
    expect(reread.position.scrollPosition).toBe(0);
  });

  it("does not treat an empty article as complete or report negative progress", () => {
    expect(isLastPage(0, 0)).toBe(false);
    expect(getProgress(-10, 4)).toBe(0.25);
    expect(getProgress(10, 4)).toBe(1);
    expect(getProgress(0, 0)).toBe(0);
  });

  it("rejects an in-flight turn when the reader's virtual-page topology changes", () => {
    expect(isCurrentReadingPagerTransition(4, 5, 4, 5)).toBe(true);
    expect(isCurrentReadingPagerTransition(6, 5, 6, 5)).toBe(true);
    // A former last-letter page can become the question page after a shrink.
    expect(isCurrentReadingPagerTransition(4, 5, 3, 3)).toBe(false);
    expect(isCurrentReadingPagerTransition(4, 5, 4, 5)).toBe(true);
    expect(isCurrentReadingPagerTransition(4, 5, 5, 5)).toBe(false);
    expect(isCurrentReadingPagerTransition(7, 5, 7, 5)).toBe(false);
  });
});

describe("reader app-state boundaries", () => {
  it("suspends and resumes once across iOS inactive/background sequences", () => {
    expect(entersReaderSuspension("active", "inactive")).toBe(true);
    expect(entersReaderSuspension("unknown", "background")).toBe(true);
    expect(entersReaderSuspension("inactive", "background")).toBe(false);
    expect(resumesReaderFromSuspension("background", "active")).toBe(true);
    expect(resumesReaderFromSuspension("active", "active")).toBe(false);
  });
});

describe("post-archive completion actions", () => {
  it("treats a second completion commit as successful without another write", () => {
    expect(getCompletionCommitDisposition("COMPLETED_READY")).toBe("commit");
    expect(getCompletionCommitDisposition("COMPLETED_COMMITTED")).toBe(
      "already_committed",
    );
    expect(getCompletionCommitDisposition("READING")).toBe("invalid");
  });

  it("allows rereading after completion was already archived", () => {
    expect(transitionSession("COMPLETED_READY", "READING")).toEqual({
      allowed: true,
      state: "READING",
    });
    expect(transitionSession("COMPLETED_COMMITTED", "READING")).toEqual({
      allowed: true,
      state: "READING",
    });
  });
});