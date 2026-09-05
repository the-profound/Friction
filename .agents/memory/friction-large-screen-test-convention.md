---
name: Test convention for large Friction screen components
description: How large Friction screen files get regression coverage, since there is no component-render test harness in this codebase.
---

There is no render-testing harness (e.g. React Native Testing Library) anywhere in this codebase. Large screen files (1000-3000+ lines) are effectively untestable via rendering, so their regression tests work by reading the screen's source file as raw text and asserting on exact substrings/slices of the code.

**Why:** this is a deliberate, established pattern, not a gap to "fix" per task — matching it keeps new tests consistent and avoids introducing a parallel testing style that only covers new code.

**How to apply:** when a task asks for regression tests on one of these large screens, write new source-text-assertion tests following the existing convention (slice the source between two anchor strings, assert on the slice) rather than trying to set up component rendering. This is a real limitation — a refactor that preserves behavior but changes internal structure can fail these tests, and a bug that preserves the asserted substrings can slip through — worth flagging as a trade-off if it becomes a recurring pain point, but not something to silently work around task-by-task.
