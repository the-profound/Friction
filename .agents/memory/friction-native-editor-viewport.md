---
name: Native editor viewport ownership
description: The keyboard, toolbar, and WebView scroll responsibilities for long-form native editing.
---

# Native editor viewport ownership

The native writing screen owns keyboard avoidance and floating-toolbar geometry. The WebView must not independently add another keyboard/content inset; it owns only document scrolling inside the frame the screen gives it.

**Why:** On iOS, combining native keyboard avoidance, WKWebView inset/scroll correction, a fixed document height, and extra toolbar padding can leave the scroll offset outside the reflowed document after a large paste. The content still exists but appears hidden behind a large blank region.

**How to apply:** Keep one document scrolling root, explicitly disable automatic native content inset adjustment, and reserve toolbar space only once. After a large paste or native frame resize, wait for layout to settle, clamp the document offset, and reveal the caret only if it is outside the visible frame; do not auto-scroll ordinary typing.