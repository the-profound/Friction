---
name: ProseMirror default scroll authority
description: A rich-text engine's own default caret-follow scroll can override an app's margin-aware scroll correction unless explicitly unified.
---

ProseMirror-based editors call their own default "scroll caret into view" on
many internal paths beyond explicit app commands — including ordinary
DOM-observed typing, not just Enter/paste/cut. An app-level scroll-correction
system that is only wired to specific events (focus, Enter, resize, paste,
drag) does not prevent the engine's own default from also firing on paths it
wasn't wired to (like plain typing), producing an uncoordinated, jarring jump
that the app's own margin-aware logic would never produce on its own.

**Why:** hooking only the app's own event handlers is not sufficient when the
underlying editor has its own independent default behavior for the same
concern; the two can fire on different subsets of the same user action and
disagree.

**How to apply:** when adopting or debugging a rich-text engine with its own
built-in scroll/caret-follow behavior, find and use the engine's official
override hook for that behavior (e.g. ProseMirror's `handleScrollToSelection`
editor prop) so there is exactly one scroll-correction authority for every
path that can trigger it, not just the paths the app happens to hook
explicitly.
