---
name: Native editor viewport ownership
description: The keyboard, toolbar, and WebView scroll responsibilities for long-form native editing.
---

# Native editor viewport ownership

The native writing screen owns keyboard avoidance and floating-toolbar geometry. A floating toolbar rendered outside the KeyboardAvoidingView must not be paired with an in-flow spacer inside it; the WebView owns only document scrolling inside the frame the screen gives it.

**Why:** On iOS, combining native keyboard avoidance, WKWebView inset/scroll correction, a fixed document height, and extra toolbar spacing can leave the scroll offset outside the reflowed document after a large paste. An in-flow spacer also shortens the WebView viewport and creates a blank band before the floating toolbar.

**How to apply:** Keep one document scrolling root, explicitly disable automatic native content inset adjustment, and do not add a fixed-height sibling for an absolutely positioned toolbar. Use document bottom padding only when it is needed to scroll the final content above the toolbar. After a large paste or native frame resize, wait for layout to settle, clamp the document offset, and reveal the caret only if it is outside the visible frame; do not auto-scroll ordinary typing.

**Touch-in-progress guard (added while auditing scroll-jump behavior):** a resize- or paste-triggered viewport correction can fire its delayed timer while the user is mid-drag on a manual scroll/selection gesture; calling `window.scrollTo` at that moment yanks the document out from under their finger. Track an `activeTouchCount` and make the correction function bail out (recording a pending-replay flag) while any touch is active, replaying once on touchend/touchcancel through the same margin-check logic — so it only actually moves the viewport if the caret is genuinely hidden, never unconditionally on every manual scroll end.

**Content-replacement scroll preservation:** every place that replaces the whole document (mode transitions like draft↔dividing/thought, auto-split re-injection, background refetch re-hydration) funnels through one editor command (`setMarkdown`/`setContent`). That single choke point is the right place to capture the scroll offset immediately before the replace and restore it after — once synchronously and once more on the next animation frame (new paragraph heights can keep reflowing after the synchronous return), clamped to the new document's max scroll, and skipped entirely while a touch is active. Avoiding a *new* scroll on the replaced selection (e.g. `focus("end", { scrollIntoView: false })`) is not the same guarantee — the `setContent` transaction's own layout reflow can still drift the scroll container even when nothing calls scrollIntoView.

**Selection-handle scroll ownership:** keep the native WebView's `scrollEnabled` value stable throughout an OS selection-handle drag. The WebView document remains the only scroll owner and follows the endpoint nearest the drag-start touch through the same margin-aware edge correction used for caret visibility. Drag end and cancellation must invalidate delayed corrections before clearing that endpoint.

**Why:** toggling React Native `scrollEnabled` while iOS owns an active selection gesture can rebuild WKWebView scroll state and reset a long document to the top. Delayed correction that survives the drag can then target the stationary endpoint after the active endpoint is cleared.

**How to apply:** selection start/end bridge events may suppress surrounding app gestures, but must not toggle the WebView scroll prop. Retain delayed caret corrections because each pass re-reads current geometry; cancel only corrections that belong to a finished selection-handle session. Use one shared finish path for touch end and cancellation, invalidate that session first, then clear drag state, active endpoint, and deferred touch correction.