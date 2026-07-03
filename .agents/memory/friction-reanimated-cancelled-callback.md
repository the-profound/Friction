---
name: Reanimated withTiming cancellation and cleanup callbacks
description: Gating cleanup logic on withTiming's `finished` flag causes permanent stuck UI state when an animation is cancelled by a new gesture/value assignment.
---

## The rule
Never gate essential state-cleanup (flags like "isAnimating"/"isFlipping", clearing a preview layer, resetting a "returning" guard, etc.) on Reanimated's `finished` argument inside a `withTiming`/`withSpring` completion callback: `(finished) => { if (finished) { ...cleanup... } }`.

**Why:** `finished` is `false` whenever the animated shared value is reassigned again before the current animation completes (e.g. a new pan-gesture drag starts, or another effect sets the same shared value). This is common with interruptible gestures. If cleanup only runs on `finished === true`, an interrupted animation leaves the UI stuck forever in its "animating" state: overlay flags stay true (real content hidden), a static preview/placeholder layer stays visible, and any "block user input while animating" ref never clears. In Friction's read.tsx this produced a "blank page" bug — the memo card got stuck edge-on (rotated to ±90°) and its real WebView (containing page count, hint text, and editor placeholder) stayed hidden at `opacity: 0`, with only a content-less preview layer showing through.

**How to apply:** In completion callbacks for `withTiming`/`withSpring`, always run cleanup/idle-state logic unconditionally (drop the `if (finished)` guard or move guarded logic to only affect things that are actually invalid on cancellation, like whether to advance a page index). Only gate on `finished` when you specifically want an early exit to be treated as "no-op, wait for the animation that superseded me" — and even then, make sure some other path in the code guarantees convergence back to idle.
