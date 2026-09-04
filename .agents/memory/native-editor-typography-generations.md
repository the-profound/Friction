---
name: Native editor typography generations
description: Ordering rule for stable WKWebView writing metrics across initial load, rotation, and reload.
---

Apply the current width and font metrics before creating editable DOM, then tag every
later metric update with a monotonic layout generation and ignore older generations.
Keep iOS text-size adjustment disabled on the editable document.

**Why:** Creating ProseMirror before its CSS variables exist allows WKWebView to lay out
content with initial or inflated font metrics. Delayed messages from an older screen
size can then restore stale wrapping after rotation, keyboard changes, or reload.

**How to apply:** Any native editor initialization or layout-message refactor must keep
metrics in the initialization payload, preserve generation ordering, and regenerate
the checked-in WebView HTML from its source.