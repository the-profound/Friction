---
name: RN text-input overlay for live markdown rendering
description: Why the memo editor's two-layer (TextInput + Text) overlay used to hide markdown markers failed, and the reliable fix.
---

## Context
`MemoPageView` (used in the reading-mode memo editor) renders live markdown
(bold/italic/underline/quote) by stacking a real `TextInput` (for
cursor/selection/typing) on top of a `pointerEvents="none"` `Text` layer that
renders the styled, marker-hidden version of the same string. Character
widths must match exactly between the two layers so the invisible input's
cursor lines up with the visible styled text underneath.

## The bug
Hiding the top `TextInput`'s glyphs via `color: "transparent"` (and hiding
marker characters in the styled `Text` layer the same way) is NOT reliable
in this project's RN setup: on-device testing showed raw markers (`*`, `**`,
`__`) and un-italicized text rendered fully visible, because the "invisible"
top layer wasn't actually invisible — it painted over the correctly styled
layer underneath.

**Why:** the CSS keyword `"transparent"` is known to be inconsistently
handled by RN's color parsing/compositing in some style-array/font
combinations, silently falling back to an opaque default color instead of
alpha 0.

## Fix
Don't rely on the `"transparent"` keyword. Instead, set the color to the
*exact same opaque hex* as the surrounding background (e.g. the memo card's
background color) for both the invisible `TextInput` text and the hidden
marker spans in the styled `Text` layer. Matching opaque colors blend in
reliably regardless of alpha-compositing quirks.

**How to apply:** any time you need to visually "hide" text/characters by
color in an RN overlay technique (not just this memo editor), prefer
`color: <exact background hex>` over `color: "transparent"`.

## Follow-up: selection highlight defeats the trick
Matching the page background only hides text against *that one* background.
Native text selection draws its own highlight box (a different color)
*behind* selected text, so hidden text becomes visible again — as garbled/
overlapping "white text" — the instant a word is selected (e.g. double-tap
select, showing the Cut/Copy/AutoFill menu).

**Fix:** set `selectionColor="transparent"` on the overlay `TextInput` so no
highlight box is ever drawn behind selected text. Selection drag handles
(the two blue dots) are a separate native UI element and remain visible, so
users still get feedback that text is selected — just without the
background box that would otherwise expose the hidden layer.
