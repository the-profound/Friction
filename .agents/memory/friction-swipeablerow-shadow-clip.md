---
name: SwipeableRow shadow-clip vs horizontal-clip tradeoff
description: Why a swipe-to-delete row's horizontal clip flattens its card's shadow, and the general fix shape.
---

# A swipe row's required horizontal clip can flatten its card's shadow

A swipe-to-delete row needs `overflow: hidden` horizontally to hide content
sliding past its own edge while open (see `friction-swipeable-edge-ornaments.md`
— this is a hard requirement, not optional). But if the clip box is sized to
exactly the card's normal-flow box, any shadow bleeding above/below that box
gets cut to a flat edge instead of showing its natural falloff.

**Why:** the two constraints conflict on the same axis (vertical) unless the
clip boundary is deliberately made larger than the card's own box in that
direction while staying pinned to the same visual position.

**How to apply:** when a shadow looks flattened inside a horizontally-clipped
swipe row, reserve extra room inside the clip boundary (sized to the shadow's
actual offset+blur) without moving the row's layout footprint — and if any
sibling (e.g. reveal action buttons) is positioned relative to that same box,
recompute its offsets so its visual position doesn't shift.
