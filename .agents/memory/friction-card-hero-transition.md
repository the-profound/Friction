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

## Source-to-Modal handoff timing

Do not hide the source slot just because selection state is set: on release, the
parent re-renders before the asynchronous native `Modal` portal has drawn. That
creates a blank flash even when the two cards are pixel-identical.

**Why:** a JavaScript `requestAnimationFrame` alone does not prove that iOS or
Android has presented the Modal or laid out the origin-sized card.

**How to apply:** keep the source visible until the overlay reports readiness.
On native, readiness requires both `Modal.onShow` and the origin card
container's `onLayout`; on web, the mounted card layout is the equivalent
signal. Hide the parent source only then, and start the spring on the next
frame. Guard callbacks with an incrementing open-session token so a late
close/reopen event cannot launch or hide the wrong card.

## Distance-aware, straight close motion

The dismiss return must animate every position-bearing value on one shared,
distance-aware clock with the same easing curve: hero progress, vertical drag
offset, and carousel track offset. A nearby origin can return sooner, while a
farther card gets more time without bending its spatial path.

The matching entry transition also uses a distance-aware timing clock and the
same strong ease-out curve, so both directions start decisively and settle
smoothly instead of pairing a slow spring with a very fast return.

**Why:** mismatched durations or easing bend the summed transform through
multiple segments. A fixed, very short duration makes long source-to-overlay
returns look unnaturally fast. A carousel can also sit between snap points
while its logical active index still equals the source index, so conditionally
omitting its offset creates a final sideways jump.

**How to apply:** snapshot progress, vertical drag, and carousel offset at
close; calculate duration from the card's remaining translation, scale, and
carousel distance; then use that exact one duration and easing for all three
values. Always return the carousel track to the source slot, even when its
logical index is already unchanged.

## Vertical dismiss composition

On a downward dismiss gesture, move only the cover-card layer. The information
bar and reading CTA stay at their layout positions and fade out as the card
starts moving, so the falling card never overlaps them.

**Why:** sharing the drag `translateY` with details makes the whole overlay
look like one panel and forces text/buttons to travel through the card's path.

**How to apply:** use one drag value only in the card transform and blend the
detail opacity with a short dismiss fade. Restore that fade whenever a
sub-threshold drag is cancelled. Map raw drag distance through a monotonic
rubber-band curve before assigning it to the card, but keep dismissal
thresholds on raw distance/velocity so resistance does not make the gesture
unreliable.

## Content parity

Any field the overlay shows must also be shown by the source card, or the card
visibly gains content on tap. Space detail feeds the space name through as
`collectionName`; the overlay derives the same value from `space.name`.
