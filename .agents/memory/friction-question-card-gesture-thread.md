---
name: Card-deck swipe — UI-thread gesture & scaled-text sharpness
description: Two durable rules for swipeable scaling card decks: keep the pan gesture on the UI thread, and never leave a clip mask/raster hint on a layer whose scale is animating.
---

**Rule 1 — a finger-tracking pan gesture belongs on the UI thread.** No `runOnJS(true)` on the handler; every value it reads must be a shared value, never a React ref. Only end-of-gesture side effects (dismissing the keyboard, committing cursor state, flipping a style flag) cross to JS.

**Why:** On the JS thread the handler competes with renders and text input, so the card visibly lags the finger. Refs make this worse silently — worklet reads are frozen at capture and writes are dropped.

**Rule 2 — a clip mask (`overflow: "hidden"`) or raster hint on a layer whose scale is animating destroys text resolution.** Both force offscreen compositing, and while the scale interpolates the buffer is re-captured at the shrunken size every frame. Gate them on the state that actually needs them (a non-zero scroll offset) and clear them the instant that state ends — including at scroll boundaries where the gesture hands off to the deck drag, not just on commit. Half-gating is the common bug: enabling on scroll start but never clearing leaves the mask on for the whole transition.

**How to apply:** Keep shadows on empty sibling layers, never on the text layer. When nesting scaled containers, make sure an ancestor's raster hint is off during any stage where the child is itself scaling, or the two downscales compound.
