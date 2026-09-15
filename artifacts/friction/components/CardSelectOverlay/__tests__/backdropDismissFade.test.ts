import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const overlayPath = join(__dirname, "../CardSelectOverlay.tsx");
const read = () => readFileSync(overlayPath, "utf8");

describe("non-drag dismiss triggers hide the details/CTA layer before the shared close routine", () => {
  it("requestClose hides the layer instantly (no animation, no delay) instead of a bare passthrough", () => {
    const overlay = read();

    // requestClose must exist as its own gate in front of runCloseRef, not a
    // bare passthrough — otherwise every non-drag trigger leaves the info
    // bar/CTA layer fully opaque and cross-fading for the whole return
    // animation, unlike the swipe dismiss where it is already invisible.
    expect(overlay).not.toContain(
      "const requestClose = useCallback(() => runCloseRef.current(), []);",
    );
    expect(overlay).toContain("const requestClose = useCallback(() => {");

    // Skip re-hiding when the swipe gesture already faded it out, so it is
    // never re-triggered or fought.
    expect(overlay).toContain("if (!verticalDismissActiveRef.current) {");

    // Non-drag triggers have no lead time before the shrink-back transform
    // starts (unlike the swipe gesture, which fades during the drag, well
    // before release). Animating this fade here would either delay the
    // shrink-back (visible pause) or run concurrently with it (the exact
    // overlap this fix removes) — so it must be snapped to invisible
    // synchronously, then the close routine run immediately after, with no
    // setTimeout/withTiming gap in between.
    const requestCloseBody = overlay.slice(
      overlay.indexOf("const requestClose = useCallback(() => {"),
      overlay.indexOf("}, [detailsFade]);", overlay.indexOf("const requestClose = useCallback(() => {")),
    );
    expect(requestCloseBody).toContain("cancelAnimation(detailsFade);");
    expect(requestCloseBody).toContain("detailsFade.value = 0;");
    expect(requestCloseBody).not.toContain("withTiming");
    expect(requestCloseBody).not.toContain("setTimeout");
    expect(requestCloseBody).toContain("runCloseRef.current();");
  });

  it("every non-drag close trigger routes through requestClose, not runCloseRef directly", () => {
    const overlay = read();

    // Backdrop tap.
    expect(overlay).toContain(
      '<Pressable style={StyleSheet.absoluteFill} onPress={requestClose} />',
    );
    // Android hardware back (falls through to requestClose unless an inline
    // dialog is active).
    expect(overlay).toContain("onRequestClose={onInlineModalRequestClose ?? requestClose}");
    // Info-bar author/collection/space navigation taps.
    expect(overlay).toContain(
      "onPress={() => { requestClose(); onNavigateToAuthor!(authorId!); }}",
    );
    expect(overlay).toContain(
      "onPress={() => { requestClose(); onNavigateToCollection!(collectionId!); }}",
    );
    expect(overlay).toContain(
      "onPress={() => { requestClose(); onNavigateToSpace!(spaceId!); }}",
    );
  });

  it("the swipe dismiss keeps calling runCloseRef directly, unaffected by the new gate", () => {
    const overlay = read();

    // Swipe release (card pan + details pan) must still call runCloseRef
    // directly — it already faded the layer via beginVerticalDismiss during
    // the drag, so it must not be routed through requestClose.
    const directCloseCount = (
      overlay.match(/if \(dy > 80 \|\| vy > 0\.8\) runCloseRef\.current\(\);/g) ?? []
    ).length;
    expect(directCloseCount).toBe(2);

    // The swipe dismiss's own duration/easing formula, and its own
    // drag-time fade (beginVerticalDismiss), must be untouched.
    expect(overlay).toContain("getCloseDuration(calculateCardReturnDistance({");
    expect(overlay).toContain("easing: REANIMATED_TRANSITION_EASING");
    expect(overlay).toContain(
      "detailsFade.value = withTiming(0, {\n      duration: DISMISS_FADE_DURATION,\n      easing: REasing.out(REasing.quad),\n    });",
    );
  });

  it("runCloseRef itself is unaffected by the requestClose gate (no new delay before the shrink-back starts)", () => {
    const overlay = read();

    // runCloseRef's own body must not depend on any close-fade timer ref —
    // the previous timer-based approach was removed entirely so no dismiss
    // trigger waits on a JS setTimeout before the shrink-back can start.
    expect(overlay).not.toContain("closeFadeTimerRef");
  });
});
