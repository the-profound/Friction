---
name: Android shadow stacking
description: How Android elevation affects sibling paint order for layered card shadows.
---

Keep Android `elevation` on the surface that contains the card content; do not
put it on an empty absolute sibling intended to be a shadow behind that content.

**Why:** Android elevation participates in sibling paint order, so an elevated
empty sibling can cover an otherwise later, non-elevated pressable with its own
opaque surface.

**How to apply:** iOS and web may use a separate shadow host for scaled-card
clarity or cross-fades. On Android, omit that sibling and apply the selected
shadow token to the containing card surface instead.