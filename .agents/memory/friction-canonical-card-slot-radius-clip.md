---
name: CanonicalCardSlot radius and clip ownership
description: Why a scaled-down cover in CanonicalCardSlot can look flatter than neighbors and show a rectangle sliver at its corners.
---

# CanonicalCardSlot: shadow and rounded clipping need separate boundaries

`CanonicalCardSlot` (`artifacts/friction/components/ArticleCardItem/CanonicalCardSlot.tsx`)
renders `ArticleCardItem` at its canonical size (`Sizing.cardSlotW`/`cardH`) and shrinks it
with `transform: [{ scale }]` into a smaller slot, so the card never recomputes
typography/padding/radius from a tiny `cardWidth`.

Two related visual bugs come from this pattern:

1. **Flatter-looking corners in tight carousels.** The canonical card's own
   radius (16px at `Sizing.cardSlotW`) shrinks proportionally with the
   transform, giving a fixed `16/300` radius-to-width ratio regardless of the
   final slot size. Neighboring plain placeholder cards in the same carousel
   often use their own fixed radius (e.g. 14px) tuned to the slot's actual
   width, which is a *different* (usually larger) ratio — so the cover reads
   as less rounded than its siblings even though nothing is technically wrong.
2. **A rectangular sliver behind the rounded corners.** The card's shadow
   (`overflow: "visible"` on `ArticleCardItem`'s `cardSurface`, by design, so
   the shadow isn't clipped mid-card) extends into the sharp-cornered gap
   between the rounded card and its bounding box. If the outer wrapper clips
   with a plain rectangle (no radius) sized exactly to the content, that
   corner triangle of shadow/background is included in the clip and reads as
   a hard-edged rectangle poking out from the rounded corner.

When the projected card needs a shadow, one node cannot safely own both the
shadow and `overflow:"hidden"`: iOS clips the shadow to the slot and makes the
card look flat. Use an unclipped outer boundary for layout, shadow, and the
shared press transform, with a same-sized rounded clip nested immediately
inside it. The canonical projection stays inside that clip.

**Why:** clipping the shadow removes it on iOS, while putting shadow on an
opaque sibling can expose a duplicate card and Android elevation can change
sibling paint order. Nesting the clip inside the real shadow-bearing container
avoids all three problems.

**How to apply:** keep the outer slot `overflow:"visible"` and apply any shadow
token there exactly once; disable the projected card's own shadow in that case.
Keep the radius on both the outer shadow geometry and the same-sized inner clip.
Apply press scale only to the outer boundary so shadow, clip, and content move
as one unit.

**Radius value: prefer the exported ratio over a fixed literal.** Space
detail's round carousel first tried a fixed literal radius override (14px,
then 16px to match the full-size cover card) for its `CanonicalCardSlot`
covers and neighboring placeholder cards, matching bug 1 above literally. The
user later rejected that: a fixed literal doesn't track the slot's actual
on-screen width, so it stops being "proportional" the moment screen width (and
therefore the computed slot width) changes. The fix that stuck: export
`CANONICAL_RADIUS_RATIO` (`16 / Sizing.cardSlotW`) from this file and have the
caller compute its own local radius constant as
`Math.max(8, Math.round(actualSlotWidth * CANONICAL_RADIUS_RATIO))` — the exact
same formula `CanonicalCardSlot` uses internally — then reuse that one local
constant for both the `CanonicalCardSlot borderRadius` prop *and* any sibling
non-`CanonicalCardSlot` placeholder cards in the same row. This keeps every
slot's rounding genuinely tied to that carousel's real card width instead of
an arbitrary shared number, while still giving plain placeholder views (which
can't use `CanonicalCardSlot`'s own default) an identical value to match.

**External ancestor clipping is the same bug in a different place.** Some grid
screens (`(tabs)/to.tsx`, `(tabs)/index.tsx`, `user-profile/recipient-only-letters.tsx`,
`of-01-detail.tsx`, `of-space-detail.tsx`) wrap each `CanonicalCardSlot` in a
plain `View` (`gridCell`/similar) used only for the FlatList/measure ref, and
some of those wrappers carry their own `overflow: "hidden"`. Turning on
`carouselShadow` on the slot does nothing visible if a clipping ancestor sits
between the slot and the grid — the shadow renders and is immediately clipped
off at the wrapper's exact-size rectangle. Grepping for `carouselShadow` and
`originUsesCarouselShadow: true` in the source is not enough to confirm the
fix works; also check every ancestor `View` up to the FlatList row/cell for
`overflow: "hidden"` (or clip via borderRadius+overflow) and remove/relocate
it, or the "restrained shadow" story silently regresses to no shadow at all.
