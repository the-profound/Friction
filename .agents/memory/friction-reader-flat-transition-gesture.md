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
the top of the shared `useAnimatedStyle` functions to force rotation → 0 when set. This keeps
every other call site of the shared style untouched — no per-call-site duplication of the
rotation math.

**Flag lifetime (learned the hard way — regressed twice):** the flag must stay 1 for the
*entire* time the overlay/card exists, and only return to 0 at moments when the page slot is
exactly at rest (translateX = 0): cancel-snap-back completion, dismiss-settle completion, or
the normal-page slot-reset layout effect. Resetting it inside the *entrance* animation's
completion callback creates a UI-thread→JS-thread gap of a few frames (before the layout
effect re-parks the slot and re-sets the flag) where rotation and the wrong shadow flash
behind the card. Also don't reset it in mid-dwell paths (direction-flip, cancel, onFinalize
recovery) — still dwelling.

**Shadow handoff during flat transitions:** the resting shadow normally lives on the static
`next` slot underneath. During a flat push transition nothing is revealed underneath, so a
static shadow box left in place bleeds its boxShadow beyond the left/right edges and reads as
a "stretched letter page lying behind the card" ghost. Fading it with drag progress does NOT
fix this (still visible mid-transition). Correct fix: while the flat flag is set, the static
next-slot shadow is fully OFF and the *moving* slot carries the shadow at full opacity
(shadow layer inside the translating slot). Because the flag only toggles when the page is at
rest, the two shadows swap on the same footprint — zero visible pop.

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
