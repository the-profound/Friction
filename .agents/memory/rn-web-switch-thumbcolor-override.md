---
name: react-native-web Switch ignores thumbColor when ON
description: Why the native RN Switch cannot be recolored reliably on Expo Web, and the shared Toggle that replaces it.
---

# `Switch` on react-native-web ignores `thumbColor` in the ON state

Setting `thumbColor` on React Native's `Switch` has **no effect on the active
(ON) thumb** under react-native-web. The library substitutes its own default
active thumb color, Material teal `#009688`, so a spec calling for a white thumb
renders teal on web while looking correct on iOS/Android.

`trackColor` *does* apply on web, which makes this especially deceptive: the
track changes color as expected, so the change looks half-applied rather than
broken, and a code-level diff review will show the "correct" props are present.

**Why:** react-native-web's Switch implementation keeps separate internal
`activeThumbColor` / `activeTrackColor` values. RN core's public API exposes only
a single `thumbColor`, which react-native-web maps to the *inactive* thumb, so
there is no public prop that reaches the active thumb.

**How to apply:**
- Do not try to recolor a native `Switch` for a design spec in this app. Use the
  shared `Toggle` in `components/shared/` — plain `View`s plus an `Animated`
  interpolated `backgroundColor`, so no library default can override it and it
  renders identically on web, iOS, and Android.
- Animate the whole toggle with a **single non-native** `Animated.Value`.
  `backgroundColor` interpolation cannot use the native driver, and mixing native
  and non-native driven props is a separate known failure mode.
- When a color change "doesn't show up," sample the actual pixels from the
  user's screenshot before re-editing the code. Here the track already matched
  the intended token exactly, which immediately localized the bug to the thumb
  and to a library default rather than to the edit not landing.
