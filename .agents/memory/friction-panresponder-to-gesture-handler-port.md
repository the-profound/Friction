---
name: PanResponder → Gesture.Pan port checklist
description: Non-obvious pitfalls when converting a PanResponder + legacy Animated.Value gesture to react-native-gesture-handler + Reanimated, learned porting CardSelectOverlay's dismiss/carousel drag.
---

When porting a `PanResponder` + `Animated.Value` drag to `Gesture.Pan` + Reanimated shared values (the codebase's established pattern, see `app/read.tsx`, `components/PreviewPager/PreviewPager.tsx`):

- **Velocity units differ.** PanResponder's `gestureState.vx`/`vy` are px/ms; RNGH's `event.velocityX`/`velocityY` are px/s. Divide RNGH velocity by 1000 before comparing against an old PanResponder-era velocity threshold, or the fling/fast-flick threshold becomes 1000x too easy to trigger.

- **Spring config maps directly.** Legacy `Animated.spring({tension, friction})` ports to Reanimated `withSpring({stiffness: tension, damping: friction, mass: 1})` (add `overshootClamping` too if the original had it) — same underlying spring model, so this preserves identical feel with no retuning.

- **`PanResponder`'s `onMoveShouldSetPanResponder` can be dead code.** If `onStartShouldSetPanResponder` already returns `true`, the responder is captured at touch-down and the "should-set" move-based negotiation never runs. The *real* direction-decision logic in that case lives in `onPanResponderMove`'s runtime `if (!gestureDirRef.current) {...}` fallback — read the move handler carefully before assuming the shouldSet thresholds are what's live.

- **A reachable `onMoveShouldSetPanResponder` (i.e. `onStartShouldSetPanResponder` returns `false`) has "capture-once" semantics**: once it returns true, PanResponder never re-checks it for the rest of the gesture. Port this with a plain ref flag (`capturedRef`) checked in `onUpdate`, not a native RNGH offset alone.

- **`onFinalize(event, success)` replaces both `onPanResponderRelease` and `onPanResponderTerminate`**, firing on every gesture end. Gate terminate-only reset logic behind `if (!success)`, and never unconditionally reset a shared value there — a just-triggered close animation (e.g. `withTiming` to 0) can still be in flight when `onFinalize` fires for the same gesture, and blindly resetting with `withSpring` there will fight/override it.

- **Nested horizontal `ScrollView` inside a new vertical `Gesture.Pan`** needs explicit `activeOffsetY`/`failOffsetX` (mirroring `PreviewPager.tsx`'s `activeOffsetX`/`failOffsetY` idiom) or the raw gesture can hijack the ScrollView's horizontal scrolling — the old PanResponder deferred to it automatically via `onMoveShouldSetPanResponder` returning false for horizontal moves, which RNGH has no equivalent bubbling negotiation for.

- **A tap-through `Pressable` inside the gesture area** should get a `.minDistance(N)` on the `Gesture.Pan` (matching whatever pixel threshold the old code used to decide "this became a drag, not a tap") so a plain tap isn't swallowed by an over-eager native gesture activation — see `read.tsx`'s `.minDistance(8)` comment for the established convention.

**Why:** discovered while converting `CardSelectOverlay.tsx`'s vertical-dismiss + horizontal-carousel drag from `PanResponder`/`Animated.Value` to `Gesture.Pan`/Reanimated (task: smooth 120Hz letter-selection drag gestures). Getting any of these wrong either changes the trigger feel (velocity units) or silently breaks a working feature (ScrollView/Pressable interop) while `tsc` and bundling stay green.
