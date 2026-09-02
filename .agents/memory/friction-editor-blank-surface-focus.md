---
name: Editor blank-surface focus ownership
description: Gesture ownership rule for reopening the keyboard from empty editor chrome without disturbing text cursor behavior.
---

Screen-level wrappers must not programmatically refocus an embedded editor after a generic touch end. Title fields, editable body DOM, links, dividers, and controls own their native cursor or action behavior; only the platform editor may request focus from a blank-surface gesture.

**Why:** A parent wrapper cannot identify the DOM target inside a native WebView. Its trailing touch end also fires after text taps and scroll handoff, which can overwrite the user's cursor position and reopen the keyboard.

**How to apply:** Keep one gesture session from start through move, scroll, cancel, and end. Require the gesture to start and end on editor chrome outside editable or interactive targets, stay below the movement threshold, and observe no scroll before focusing.