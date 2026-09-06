import { describe, it, expect } from "vitest";
import { createClosingTransitionSuppressionController } from "@/lib/closingTransitionSuppression";

describe("closing transition suppression controller", () => {
  it("is not pending before begin() is called", () => {
    const controller = createClosingTransitionSuppressionController();
    expect(controller.isPending()).toBe(false);
  });

  it("becomes pending immediately after begin()", () => {
    const controller = createClosingTransitionSuppressionController();
    controller.begin();
    expect(controller.isPending()).toBe(true);
  });

  it("full lifecycle: forward transition suppresses, then a later focus resets it and signals a rerender", () => {
    const controller = createClosingTransitionSuppressionController();

    // Screen starts a self-initiated closing transition (optimistic patch
    // about to land) — the false-positive window begins.
    controller.begin();
    expect(controller.isPending()).toBe(true);

    // The screen regains focus (transition failed, or the user navigated
    // back) while still pending: this must clear suppression AND report
    // that a rerender is required, since clearing a plain flag alone would
    // not otherwise cause the screen to re-evaluate and show a real error.
    const clearedOnThisFocus = controller.handleFocus();
    expect(clearedOnThisFocus).toBe(true);
    expect(controller.isPending()).toBe(false);
  });

  it("a focus event that finds nothing pending is a no-op and does not ask for a rerender", () => {
    const controller = createClosingTransitionSuppressionController();

    // Never began a transition — an ordinary focus (e.g. first mount) must
    // not report that anything changed.
    expect(controller.handleFocus()).toBe(false);
    expect(controller.isPending()).toBe(false);
  });

  it("does not re-trigger a rerender on a second consecutive focus after it already cleared", () => {
    const controller = createClosingTransitionSuppressionController();
    controller.begin();

    expect(controller.handleFocus()).toBe(true);
    // A subsequent focus (e.g. the user leaves and returns again) finds
    // nothing pending anymore and must not ask for another forced rerender.
    expect(controller.handleFocus()).toBe(false);
    expect(controller.isPending()).toBe(false);
  });

  it("supports beginning a new transition again after a previous one was cleared", () => {
    const controller = createClosingTransitionSuppressionController();
    controller.begin();
    controller.handleFocus();
    expect(controller.isPending()).toBe(false);

    // The user retries the same transition later — suppression must be able
    // to engage again, not be permanently disabled after its first use.
    controller.begin();
    expect(controller.isPending()).toBe(true);
  });
});
