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

### Image-cover readiness

When the selected card has an image cover, modal/layout readiness alone is not
enough: wait for `expo-image` to report that the target image is displayed
before hiding the source. Gate that callback with a generation token tied to
the open session, selected slot, and image URL.

**Why:** an image callback can outlive a close/reopen, or arrive after a reply
chain prepends slots and changes the target index. A session-only guard lets
that stale callback hide a source before the current target is visible.

**How to apply:** advance the gate whenever any session/slot/URL identity
changes, capture it in the image callback, and compare all four values on
delivery. Do not treat `onError` as a display event; first render a deliberate
fallback surface, then release the source on a following frame.

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


### Non-drag close triggers (backdrop tap, hardware back, nav-away taps)

These never ran the drag gesture's early fade, so naively animating the same
fade for them at close time either lets that layer keep cross-fading for the
whole shrink transform (visible jank) or forces the shrink to wait for the
fade to finish first (a dead pause that reads as "nothing happened, then it
just vanished").

**Why:** the drag path gets a graceful fade for free because it starts the
moment a downward drag begins, long before release — by release time the
layer is already invisible with zero added delay. A non-drag trigger has no
such lead time to borrow from.

**How to apply:** for non-drag triggers, snap the detail/CTA layer straight to
its final hidden value (cancel any in-flight animation, set the value
directly, no `withTiming`) in the same tick as starting the shrink-back — do
not animate it and do not delay the shrink-back behind it. The layer is small
and secondary next to the dominant hero transform, so an instant snap next to
a large simultaneous animation is not perceptible as a pop.


## Completion-source safety

Reanimated's `valueSetter` can short-circuit a `withTiming(target, ...)` call
when the shared value already equals its target, invoking that animation's
completion callback synchronously before a frame runs. A close routine must not
attach unmount or finalization to a value that can legitimately already be at
its target on some trigger path: `swipeY` is zero for backdrop, hardware-back,
and info-bar navigation closes, while it is nonzero for a swipe dismissal.

**Why:** a callback on that already-settled value can unmount the Modal before
the progress-driven shrink-back renders, making a close look like an abrupt
snap even though the hero animation was configured with a normal duration.

**How to apply:** choose one close-progress value that always starts away from
its target as the sole completion source, and use other shared values only for
their visual animation. Keep session-reset refs explicit on every fresh open
when a previous gesture can leave them active.

## Content parity

Any field the overlay shows must also be shown by the source card, or the card
visibly gains content on tap. Space detail feeds the space name through as
`collectionName`; the overlay derives the same value from `space.name`.

## Shadow-token parity (`originUsesCarouselShadow`)

If the source grid renders `ArticleCardItem` with `carouselShadow` (the
restrained `Shadows.carouselCard` token, used by tighter carousels/grids),
the matching `openLetterOverlay(...)` call must also pass
`originUsesCarouselShadow: true`.

**Why:** without the flag, `CardSelectOverlay` opens/closes using the larger
standard `Shadows.card` token by default. The shadow visibly "pops" to the
bigger token right at the card's rounded corners during the hero transition —
a corner-leak bug distinct from (and easy to conflate with) the
CanonicalCardSlot radius/clip issue above.

**How to apply:** treat `carouselShadow` on the source card and
`originUsesCarouselShadow` on its `openLetterOverlay` call as one pair that
must always be set together. When adding a new grid/carousel that opts a
letter cover into `carouselShadow`, grep other `carouselShadow` call sites
(`on.tsx`, `index.tsx`, `of-01-detail.tsx` as of this writing) to confirm the
pairing convention before assuming a new site is correct by copy-paste.

## Radius parity for a resting radius set via `originCardRadius`

Most `CanonicalCardSlot` callers never pass an explicit `borderRadius`, so the
slot's resting radius is already `width * CANONICAL_RADIUS_RATIO` (that
component's own exported ratio) — exactly what the overlay's own natural
(unoverridden) radius produces at `progress === 0` too. No special handling is
needed there, even if the caller separately computes and passes that same
formula's result explicitly (see `friction-canonical-card-slot-radius-clip.md`
— space detail's round carousel does this so its neighboring, non-`CanonicalCardSlot`
placeholder cards can match the same value).

`openLetterOverlay(..., { originCardRadius })` exists for the case where a
destination slot's resting radius is *not* derivable from the overlay's own
natural progress=0 math — e.g. a genuinely different, hand-picked ratio, not
just the same ratio computed and passed through explicitly. When the two
diverge, the overlay's hero card must be told the destination's exact resting
radius so its close animation's last frame lands on it, via
`CardSelectOverlay`'s `originCardRadius` prop, threaded down through
`ArticleCardItem`/`ArticleCardCover`'s `radiusOverride` (a Reanimated
`SharedValue`, applied on the UI thread every frame, not a one-shot prop).

**Why:** without it, whenever the destination's resting radius truly diverges
from the overlay's natural proportional radius, the overlay renders the
natural value while closing and the instant the Modal unmounts, the real
static slot underneath snaps to its own (different) value — a hard, one-frame
jump in effective on-screen radius that reads as the corner suddenly getting
"cut," distinct from (and easy to conflate with) the shadow-token pop this
section is modeled after. Passing `originCardRadius` even when the two values
already coincide is harmless and future-proofs the pairing if the destination
formula changes independently later.

**How to apply:** the override only needs to converge the *closed* end
(`progress === 0`) onto the destination's fixed radius; the *open* end
(`progress === 1`) must stay exactly the natural canonical radius so opening
into the full-size overlay is unaffected. Interpolate the on-screen radius
between `[originCardRadius, canonicalRadius * finalScale]` over `progress`,
then divide by the current transform scale to get the pre-transform radius to
actually render — the transform will re-multiply it back to the intended
on-screen value every frame. Pass this only to the slot that is the actual
transition origin (`i === initialIndex` in the multi-card branch); other
callers that never set `originCardRadius` get `radiusOverride={undefined}` and
see zero behavior change.
