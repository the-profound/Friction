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

# Rule 3 — keyed arrays preserve moves, not eviction from a finite window

A key preserves an instance only while that key remains in the rendered array. In a three-slot pager,
moving two or more pages away removes the old page key and unmounts its component. Any draft or answer
that must survive navigation beyond the retained window must be owned by the screen/session above the
pager and passed into the page as controlled state.

**Why:** both bugs produced the same symptom (flicker on page transitions) and were previously papered over
with unmount-deferral and opacity gates, which cost state (WebView scroll/render state, card deck state).
Separately, a keyed three-slot window appeared to preserve question-card answers until users navigated far
enough to evict that key; returning then mounted a fresh card with empty local state.

**How to apply:** any time slots/roles rotate around a fixed number of mounted views — readers, carousels,
card decks. If you must hide a slot for one commit, hide it with opacity, never by rendering `null`;
`null` throws away the instance you were trying to preserve. Put user-authored transient state above the
window whenever it must survive a page leaving the retained slot range.
