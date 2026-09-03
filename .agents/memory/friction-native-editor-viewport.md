---
name: Native editor viewport ownership
description: The keyboard, toolbar, and WebView scroll responsibilities for long-form native editing.
---

# Native editor viewport ownership

The native writing screen owns keyboard avoidance and floating-toolbar geometry. A floating toolbar rendered outside the KeyboardAvoidingView must not be paired with an in-flow spacer inside it; the WebView owns only document scrolling inside the frame the screen gives it.

**Why:** On iOS, combining native keyboard avoidance, WKWebView inset/scroll correction, a fixed document height, and extra toolbar spacing can leave the scroll offset outside the reflowed document after a large paste. An in-flow spacer also shortens the WebView viewport and creates a blank band before the floating toolbar.

**How to apply:** Keep one document scrolling root, explicitly disable automatic native content inset adjustment, and do not add a fixed-height sibling for an absolutely positioned toolbar. Use document bottom padding only when it is needed to scroll the final content above the toolbar. After a large paste or native frame resize, wait for layout to settle, clamp the document offset, and reveal the caret only if it is outside the visible frame; do not auto-scroll ordinary typing.