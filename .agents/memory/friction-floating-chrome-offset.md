---
name: Friction floating chrome offset unification
description: Toolbar/InlineMenuPanel/AddMenuPopup on the writing screen must derive their bottom offset from one shared resolver, not independent inline calculations.
---

The writing screen's floating toolbar, InlineMenuPanel, and AddMenuPopup are
all anchored above the keyboard/inline-panel area. Each used to compute its
own "how far above the bottom should I float" value:

- The toolbar used `keyboardVisible ? keyboardHeight : inlinePanelHeight`.
- InlineMenuPanel got the already-computed `inlinePanelHeight` fallback.
- AddMenuPopup got the **raw** `keyboardHeight` state directly, with no
  fallback to the last-known keyboard height or the screen-ratio estimate.

Because `Keyboard.dismiss()` is called deliberately when opening an inline
panel (native `keyboardVisible`/`keyboardHeight` reset to 0/false while the
panel and toolbar stay visible), any consumer using the raw values instead of
the "last known height, else screen-ratio estimate" fallback would render at
a different height than its siblings for one frame — a visible double jump
once the real value caught up.

**Why:** three independent call sites computing the same "chrome bottom
offset" concept is exactly the kind of divergence that produces inconsistent
positioning across a keyboard/panel transition, which is what task 2060
("작성 화면 이동 자연스럽게 정리") was about eliminating.

**How to apply:** any new floating surface anchored to the writing screen's
keyboard/panel chrome must call `resolveFloatingChromeOffset` (in
`lib/floatingChromeOffset.ts`) and use its return value directly — never
recompute `keyboardVisible ? keyboardHeight : ...` inline. `AddMenuPopup`'s
prop is named `chromeOffset` (not `keyboardHeight`) specifically to prevent a
future consumer from passing the raw, unfallback-ed keyboard height again.
