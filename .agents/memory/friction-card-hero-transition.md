---
name: Friction letter-card hero transition
description: Why CardSelectOverlay grow/shrink transitions look seamless on some screens and "swap" on others — the canonical card-width contract.
---

# Letter-card hero transition (CardSelectOverlay)

`CardSelectOverlay` animates a tapped card from its origin rect to centre screen.
It always renders `ArticleCardItem` at the **canonical** width `Sizing.cardSlotW`
and gets to the origin size with a transform:
`originScale = originLayout.width / Sizing.cardSlotW`.

## The rule

**A carousel/grid that feeds `CardSelectOverlay` must render its card as a
visual shrink of the canonical card — never natively at a smaller `cardWidth`.**

Where the slot width already equals the canonical width (inbox, profile), this is
automatic: `originScale` is exactly 1 and the overlay card is pixel-identical to
the source card. Where the slot is narrower (space detail's 2.5-cards-visible
layout), render the canonical card and shrink it with a `transform: [{ scale }]`
wrapper instead of passing `cardWidth`.

**Why:** `ArticleCardItem` re-derives font sizes, padding and radius from
`scale = cardWidth / Sizing.cardSlotW`, but clamps them with `Math.max` floors
(title 8, author 6, collection 5, padding 6, radius 8). Below ~half the canonical
width those floors bind, so a natively-small card is *not* a linear shrink of the
canonical one. The transition then visibly swaps one layout for another at
progress=0, and flashes again when it lands back at progress=0 on close.

**How to apply:** RN `scale` is centre-origin, so offset the inner canonical-sized
box by half the size difference (`left: (slotW - canonW)/2`) and clip with
`overflow: "hidden"` on the outer slot. Touch still works: the inner view's
*transformed* bounds equal the outer box, so hit-testing descends correctly.

## Two traps

- **Do not "fix" a duplicate/flashing card by deleting the source-card hiding.**
  Hiding the origin card while the overlay is up (`hiddenCardId` → `opacity: 0`)
  is the intended, shared design; inbox does it too. Removing it leaves the small
  card visible behind the enlarged one. A visible mismatch at progress=0 is a
  *card-geometry* bug, not a hiding bug.
- **Start the open spring only after the Modal has actually painted.**
  `setRendered(true)` merely schedules a render, so a spring started in the same
  effect body is already past progress=0 when the Modal first appears — the card
  pops in half-enlarged. Defer with double-`requestAnimationFrame`, guarded by the
  opened ref so a fast close doesn't animate.

## Content parity

Any field the overlay shows must also be shown by the source card, or the card
visibly gains content on tap. Space detail feeds the space name through as
`collectionName`; the overlay derives the same value from `space.name`.
