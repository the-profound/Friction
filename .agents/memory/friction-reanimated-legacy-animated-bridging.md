---
name: friction-reanimated-legacy-animated-bridging
description: How to migrate one Animated.Value (JS-thread) to a Reanimated shared value (UI-thread) while sibling values stay on legacy Animated, without a full-component rewrite.
---

# Mixing Reanimated shared values with legacy `Animated.Value` siblings

Friction has several components where only part of an animation is being
migrated from legacy React Native `Animated` (JS thread, `useNativeDriver:
false`) to Reanimated (UI thread) — e.g. converting just the hero
grow/shrink transition while a `PanResponder`-driven drag on the same
component stays on legacy `Animated` for a later, separate task.

**A Reanimated shared value and a legacy `Animated.Value` cannot be combined
directly** (no `Animated.add`/`Animated.multiply` equivalent across the two
engines, and Reanimated worklets cannot call RN's legacy `Easing` functions).
When a visual property is the composition of a shared value and a legacy
value (e.g. opacity = progress-driven-fade × drag-driven-fade, or translate =
progress-driven-offset + drag-driven-offset), split it into **nested views**:
an outer view carrying the Reanimated `useAnimatedStyle` and an inner view
carrying the legacy `Animated.Value`-derived style. Opacity composes correctly
this way (nested opacity multiplies visually); for translate, put the
Reanimated transform on the outer wrapper and the legacy transform on the
inner one.

**Why:** this keeps the two engines fully independent — no need to touch or
retime the untouched PanResponder gesture code — while producing the same
final pixel output as the old single combined `Animated` expression. Confirmed
correct in a hero-transition migration where `Animated.multiply(progressOpacity,
detailsFade)` was replaced by nesting a `progressDetailsAnimatedStyle`
(Reanimated) wrapper around a legacy `detailsFade`-opacity `Animated.View`.

**How to apply:** when a task scope explicitly excludes converting a sibling
gesture/animation on the same component, do this nested-view split rather
than either (a) converting everything to Reanimated to make composition easier
(scope creep, risks the excluded gesture code) or (b) trying to bridge the two
value systems directly (not supported). Also duplicate any legacy `Easing`
curve as a Reanimated `Easing` constant with a comment to keep both in sync
manually — there is no automatic bridge.
