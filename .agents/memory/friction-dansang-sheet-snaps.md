---
name: Dansang bottom sheet snap semantics
description: What "full" means for the reading-mode dansang bottom sheet and why snap points must be visually distinct
---

# Dansang bottom sheet snap semantics

Rule: the "full" snap target for the dansang bottom sheet is **maxPanelHeight** (screen minus top inset, near the notch) — the same height the sheet reaches when the keyboard opens. The default open height (~58%) is only the initial mount height, NOT a snap point. Snap stages: 100% (max) / 50% (mid) / 0% (close).

**Why:** Two rounds of "drag to notch doesn't snap to full" bug reports turned out not to be gesture bugs at all — the code snapped to the 58% default height, which is visually indistinguishable from the 50% mid stage, so the user perceived it as "snapping back to mid". Gesture/value-tracking fixes (reading `_value`, dedicated drag-height ref) didn't resolve the complaint; changing the snap target did.

**How to apply:** When users report "snap doesn't work", first check whether the snap targets are visually distinguishable (>15% screen height apart) before debugging gesture plumbing. Fast-downward-swipe should step down ONE stage relative to `mid` (`currentH > mid ? mid : 0`), not relative to `full`, or the default open height skips mid and closes instantly.

Also: grabbing the handle must `stopAnimation()` on the height Animated.Value first — an in-flight spring otherwise keeps overwriting `setValue` from the pan move handler.
