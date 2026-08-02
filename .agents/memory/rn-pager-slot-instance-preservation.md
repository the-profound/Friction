---
name: Pager slot instance preservation (RN + Reanimated)
description: Why a 3-slot pager remounts its page views (and its WebView readers) even though keys look right, and the two rules that keep instances alive.
---

# Rule 1 — render pager slots as a keyed ARRAY, never as static JSX siblings

A pager that renders three sibling slots as fixed JSX children (`<View key={next}/><View key={current}/><View key={prev}/>`)
does **not** get instance reuse from React. Fixed children lists are reconciled *by position*; a key that
changes at a position means "replace", so every page turn unmounts and remounts the page view at that slot.
For WebView-backed readers this shows up as a flash: fresh WebView → initial-load overlay → font spinner → fade-in.

Rendering the same three slots as `array.map(...)` with page-index keys makes React reconcile by key and
*move* the existing instance between positions instead. Array order still defines z-order on native.

# Rule 2 — don't swap animated style OBJECTS between roles

If each role owns its own `useAnimatedStyle` and you hand a moved view a different style object,
Reanimated detaches the old style and attaches the new one; for a frame the transform is empty and the
view paints at translateX 0 (centre) — a "ghost" flash.

Instead give each slot view **one** `useAnimatedStyle` for its lifetime and pass the role as a plain prop /
dependency, branching on it inside the worklet. Same for the shadow layer style.

**Why:** both bugs produced the same symptom (flicker on page transitions) and were previously papered over
with unmount-deferral and opacity gates, which cost state (WebView scroll/render state, card deck state).

**How to apply:** any time slots/roles rotate around a fixed number of mounted views — readers, carousels,
card decks. If you must hide a slot for one commit, hide it with opacity, never by rendering `null`;
`null` throws away the instance you were trying to preserve.
