---
name: Friction reader special-case transitions & gesture-following swipe conversion
description: How to make one specific pager transition skip the lift/rotate effect, and how to convert a fixed-timing onEnd-only swipe into a real gesture-following one.
---

# Suppressing the lift/rotate/shadow effect for one specific transition only

The reader's page-turn (`currentSlotAnimStyle`/`currentShadowStyle` in `read.tsx`) derives
rotation and shadow opacity purely from the shared value driving `translateX`, so there's
no natural hook to special-case a single transition (e.g. last-page → question-card) without
touching every other normal page turn that reuses the same style functions.

**Pattern:** add a dedicated boolean-ish shared value (e.g. `flatTransitionSV`, 0/1) read at
the top of the shared `useAnimatedStyle` functions to force rotation → 0 and shadow opacity → 0
when set. Set it to 1 immediately before starting the special transition's `withTiming`, and
reset it to 0 inside that same `withTiming`'s completion callback (before/alongside the
`runOnJS` continuation). This keeps every other call site of the shared style untouched — no
per-call-site duplication of the rotation math.

# Converting a fixed-timing onEnd-only swipe into a gesture-following one

Some UI swipes were implemented as `Gesture.Pan().onEnd(...)` only — checking `translationX`
at release and firing one fixed-duration `withTiming`, so the visual never tracks the finger
mid-drag. To match the app's other gesture-following swipes (the main reader pager), convert to:
`onBegin` (capture current position into a `dragStartX` shared value), `onUpdate` (position =
`dragStartX + translationX`, clamped to the valid range), `onEnd` (commit vs snap-back decided
by `distance > 22%·width OR velocity > 450`, matching the main pager's own thresholds),
`onFinalize` (snap back if the gesture ended without going through `onEnd`'s commit path — guard
with a local `isCommittingRef` so a just-started commit animation isn't immediately fought by
finalize's snap-back).

**Why 22%/450:** these are the app's existing pager thresholds (see `friction-reader-pager.md`
neighbors) — reuse them by default for any new drag-to-dismiss/drag-to-navigate gesture in this
app rather than inventing new constants, so the "swipe feel" stays consistent app-wide.
