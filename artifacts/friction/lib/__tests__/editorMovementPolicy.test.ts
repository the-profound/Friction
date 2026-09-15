import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// on-01a.tsx-scale screens have no render harness (see repo convention in
// on01aAutosave.test.ts / bodyLayout.test.ts), so these are source-text
// contract tests: they assert the single-offset policy and the gesture bug
// fixes stay wired the way this task established, instead of re-diverging
// into duplicated ad-hoc calculations.
const appRoot = join(__dirname, "../..");
const readScreen = () => readFileSync(join(appRoot, "app/on-01a.tsx"), "utf8");
const readAddMenuPopup = () =>
  readFileSync(join(appRoot, "components/MemoToolbar/AddMenuPopup.tsx"), "utf8");
const readInlineMenuPanel = () =>
  readFileSync(
    join(appRoot, "components/InlineMenuPanel/InlineMenuPanel.tsx"),
    "utf8",
  );
const readEditorSource = () =>
  readFileSync(
    join(appRoot, "components/WebViewMarkdownEditor/editorWebviewSrc/index.ts"),
    "utf8",
  );

describe("writing screen floating-chrome offset policy", () => {
  it("derives the floating toolbar/panel/popup offset from one shared resolver", () => {
    const screen = readScreen();

    expect(screen).toContain(
      'import { resolveFloatingChromeOffset } from "@/lib/floatingChromeOffset";',
    );
    expect(screen).toContain("const floatingChromeOffset = resolveFloatingChromeOffset({");
    // The floating toolbar must read the shared value directly rather than
    // re-deriving its own keyboardVisible ? keyboardHeight : ... ternary —
    // that duplication is exactly what caused the toolbar and the add-menu
    // popup to sit at different heights during a keyboard/panel transition.
    expect(screen).toContain("{ bottom: floatingChromeOffset }");
    expect(screen).not.toContain("keyboardVisible ? keyboardHeight : inlinePanelHeight");
  });

  it("feeds the same offset into the add-menu popup instead of the raw keyboard height", () => {
    const screen = readScreen();
    expect(screen).toContain("<AddMenuPopup");
    expect(screen).toContain("chromeOffset={floatingChromeOffset}");
  });

  it("AddMenuPopup positions itself off the shared chrome offset, not a private keyboard-height prop", () => {
    const popup = readAddMenuPopup();
    expect(popup).toContain("chromeOffset: number");
    expect(popup).toContain("bottom: chromeOffset + TOOLBAR_H + 4");
    expect(popup).not.toContain("keyboardHeight: number");
  });

  it("InlineMenuPanel still receives the panel height by the existing prop name", () => {
    // Prop name is unchanged (panelHeight) even though its value now comes
    // from the shared resolver — this just documents that contract so a
    // future refactor of on-01a.tsx doesn't silently drop the wiring.
    const panel = readInlineMenuPanel();
    expect(panel).toContain("panelHeight: number");
  });
});

describe("WebView blank-surface tap and swipe-down gesture contracts", () => {
  it("actually creates the blank-surface touch session on touchstart", () => {
    const source = readEditorSource();
    // Previously `surfaceTouchSession` was declared but only ever set to
    // `null`; isStationaryBlankSurfaceTap's session guard meant the "tap a
    // blank area to refocus the editor" gesture never fired.
    expect(source).toContain("surfaceTouchSession = createEditorSurfaceTouchSession(");
  });

  it("reads the touchend position from changedTouches, not the now-empty touches list", () => {
    const source = readEditorSource();
    expect(source).toMatch(/touchend[\s\S]{0,400}e\.changedTouches\[0\]/);
  });

  it("computes the swipe-down-to-dismiss delta from its own start position", () => {
    const source = readEditorSource();
    // Regression: this used to read an undeclared `t` and compare against
    // selHandleDragStartY — a variable that belongs to the separate,
    // legitimate OS-selection-handle-drag tracker elsewhere in this file —
    // throwing a ReferenceError on every touchmove and silently disabling
    // the gesture. Scope the assertion to the swipe-down block itself so it
    // doesn't collide with that unrelated (and correct) selHandleDragStartY
    // usage.
    const swipeBlockStart = source.indexOf("const SWIPE_THRESHOLD = 48;");
    expect(swipeBlockStart).toBeGreaterThan(-1);
    const swipeBlock = source.slice(swipeBlockStart, swipeBlockStart + 800);
    expect(swipeBlock).toContain("var dy = touch.clientY - swipeStartY;");
    expect(swipeBlock).not.toContain("var dy = t.clientY - selHandleDragStartY;");
  });

  it("defers viewport auto-correction while the user is actively touching the screen", () => {
    const source = readEditorSource();
    expect(source).toContain("let activeTouchCount = 0;");
    expect(source).toContain("let pendingViewportCorrectionAfterTouch = false;");
    expect(source).toMatch(
      /function correctDocumentViewport[\s\S]{0,250}if \(activeTouchCount > 0/,
    );
  });

  it("keeps correcting toward the active selection handle during its drag session", () => {
    const source = readEditorSource();
    expect(source).toContain("let activeSelectionEndpoint: SelectionEndpoint | null = null;");
    expect(source).toContain("resolveActiveSelectionEndpoint({");
    expect(source).toContain('activeSelectionEndpoint === "anchor"');
    expect(source).toContain("activeTouchCount > 0 && !selectionHandleDragging");
    expect(source).toMatch(
      /onSelectionUpdate[\s\S]{0,180}selectionHandleDragging[\s\S]{0,80}scheduleViewportCorrection\(true\)/,
    );
    expect(source).toMatch(
      /finishSelectionHandleDrag[\s\S]{0,500}viewportCorrectionGeneration\+\+;[\s\S]{0,180}selectionHandleDragging = false;[\s\S]{0,120}onSelHandleDragEnd[\s\S]{0,160}activeSelectionEndpoint = null;[\s\S]{0,100}pendingViewportCorrectionAfterTouch = false/,
    );
  });

  it("keeps native WebView scrolling stable instead of toggling scrollEnabled mid-selection", () => {
    const component = readFileSync(
      join(appRoot, "components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx"),
      "utf8",
    );
    expect(component).toContain("scrollEnabled={scrollEnabled}");
    expect(component).not.toContain("setScrollLocked");
    expect(component).not.toContain("scrollEnabled={scrollEnabled && !scrollLocked}");
  });

  it("uses the same cancellation cleanup for selection drag end and cancel", () => {
    const source = readEditorSource();
    expect(source).toContain(
      'document.addEventListener("touchend", finishSelectionHandleDrag, { passive: true });',
    );
    expect(source).toContain(
      'document.addEventListener("touchcancel", finishSelectionHandleDrag, { passive: true });',
    );
  });
});

describe("WebView content-replacement scroll preservation (mode transitions & auto-split re-injection)", () => {
  // setMarkdown is the single call every content-reinjection path in
  // on-01a.tsx goes through: draft<->dividing/thought mode transitions
  // (enterDividingMode/returnToThoughtMode), the promotion flow, and
  // auto-split's joined-content re-injection. It used to only avoid
  // *introducing new* scroll (focus("end", { scrollIntoView: false })) but
  // never defended against the setContent reflow itself shifting the
  // scroll container — this fixes that at the one shared choke point
  // instead of teaching every call site its own anchor logic.
  it("captures the scroll position before replacing the document", () => {
    const source = readEditorSource();
    const caseStart = source.indexOf('case "setMarkdown": {');
    expect(caseStart).toBeGreaterThan(-1);
    const setMarkdownCase = source.slice(caseStart, caseStart + 2200);
    expect(setMarkdownCase).toContain(
      "activeTouchCount === 0 ? getDocumentScrollTop() : null",
    );
    // Captured strictly before the replacing transaction, not after.
    const captureIdx = setMarkdownCase.indexOf("scrollTopBeforeReplace =");
    const setContentIdx = setMarkdownCase.indexOf("editor.commands.setContent(html);");
    expect(captureIdx).toBeGreaterThan(-1);
    expect(setContentIdx).toBeGreaterThan(captureIdx);
  });

  it("restores the captured scroll position after replacing the document, unless the user is touching", () => {
    const source = readEditorSource();
    expect(source).toContain("function restoreDocumentScrollTop(target: number) {");
    expect(source).toContain("if (scrollTopBeforeReplace !== null) {");
    expect(source).toContain("restoreDocumentScrollTop(scrollTopBeforeReplace);");
    // Guards every restore attempt (including the deferred rAF re-apply)
    // behind the same touch-in-progress check used by the viewport
    // auto-correction guard, so a mid-touch content swap never fights the
    // user's finger.
    expect(source).toMatch(
      /function restoreDocumentScrollTop[\s\S]{0,300}if \(activeTouchCount > 0\) return;/,
    );
  });

  it("re-applies the restore once more after layout settles, clamped to the new document length", () => {
    const source = readEditorSource();
    const fnStart = source.indexOf("function restoreDocumentScrollTop(target: number) {");
    expect(fnStart).toBeGreaterThan(-1);
    const fn = source.slice(fnStart, fnStart + 900);
    expect(fn).toContain("Math.max(0, scrollingElement.scrollHeight - viewportHeight)");
    expect(fn).toContain("Math.min(Math.max(0, target), maxScrollTop)");
    expect(fn).toContain("apply();");
    expect(fn).toContain("requestAnimationFrame(apply);");
  });
});
