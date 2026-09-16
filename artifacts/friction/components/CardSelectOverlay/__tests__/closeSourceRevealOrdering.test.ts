import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const overlayPath = join(__dirname, "../CardSelectOverlay.tsx");
const hookPath = join(__dirname, "../../../hooks/useLetterSelectionOverlay.tsx");
const readOverlay = () => readFileSync(overlayPath, "utf8");
const readHook = () => readFileSync(hookPath, "utf8");

const extractBlock = (source: string, startMarker: string, endMarker: string) => {
  const start = source.indexOf(startMarker);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(endMarker, start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe("close-side source reveal happens before the Modal is hidden", () => {
  it("finishClose calls onWillClose before setRendered(false), and onClose after", () => {
    const overlay = readOverlay();
    const finishClose = extractBlock(
      overlay,
      "const finishClose = () => {",
      "const finishCloseWithIndex = (idx: number) => {",
    );

    // The Modal is a separate native window/surface from the screen
    // underneath it. Even though onWillCloseRef/setRendered/onClose all run
    // synchronously in one JS callback, the two surfaces are not guaranteed
    // to repaint in the same native frame. Revealing the source first
    // guarantees an overlapping, pixel-identical frame instead of a gap
    // where neither the Modal's finished hero card nor the (still-hidden)
    // source card is visible.
    const willCloseIdx = finishClose.indexOf("onWillCloseRef.current?.()");
    const setRenderedIdx = finishClose.indexOf("setRendered(false)");
    const onCloseIdx = finishClose.indexOf("onClose()");

    expect(willCloseIdx).toBeGreaterThan(-1);
    expect(setRenderedIdx).toBeGreaterThan(-1);
    expect(onCloseIdx).toBeGreaterThan(-1);
    expect(willCloseIdx).toBeLessThan(setRenderedIdx);
    // onClose (which also clears selectedArticle/selectedMeta) must run
    // after the Modal is already hidden -- CardSelectOverlay is still
    // mounted for one more tick after setRendered(false) and would flash a
    // loading placeholder if its content data disappeared before that.
    expect(setRenderedIdx).toBeLessThan(onCloseIdx);
  });

  it("useLetterSelectionOverlay reveals the source via onWillClose, not folded into closeOverlay", () => {
    const hook = readHook();

    expect(hook).toContain("onWillClose={() => setIsSelectedSourceHidden(false)}");

    // closeOverlay (onClose) still resets it too, for any path that doesn't
    // go through onWillClose, but the reveal must not depend solely on that
    // late reset.
    const closeOverlay = extractBlock(hook, "const closeOverlay = useCallback(() => {", "}, []);");
    expect(closeOverlay).toContain("setIsSelectedSourceHidden(false);");
  });
});
