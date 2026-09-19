---
name: CanonicalCardSlot radius and clip ownership
description: Why a scaled-down cover in CanonicalCardSlot can look flatter than neighbors and show a rectangle sliver at its corners; the module renders no shadow at all (2026-09).
---

# CanonicalCardSlot: rounded clipping needs its own boundary

`CanonicalCardSlot` (`artifacts/friction/components/ArticleCardItem/CanonicalCardSlot.tsx`)
renders `ArticleCardItem` at its canonical size (`Sizing.cardSlotW`/`cardH`) and shrinks
it with `transform: [{ scale }]` into a smaller slot, so the card never recomputes
typography/padding/radius from a tiny `cardWidth`.

**As of 2026-09, the letter card module (`CanonicalCardSlot` + `ArticleCardItem` +
`CardSelectOverlay`) has a "no shadow, ever" contract** — resting cards and the
selection-overlay-expanded card are both flat, and there is no shadow-related prop
(`carouselShadow`, `noShadow`, `shadowProgress`, `shadowScale`, `originUsesCarouselShadow`)
on any of the three components. `app/(tabs)/__tests__/letterCoverCardCornerClip.test.ts`
scans every screen under `app/` (not a hardcoded list) for these retired tokens and for
`Shadows.*` usage inside the module's own source, so a new screen or a reintroduced shadow
fails that test automatically — extend it rather than adding a screen-specific shadow test.

The remaining structural bug this file exists for is rounding, not shadow:

**Flatter-looking corners in tight carousels.** The canonical card's own
radius (16px at `Sizing.cardSlotW`) shrinks proportionally with the
transform, giving a fixed `16/300` radius-to-width ratio regardless of the
final slot size. Neighboring plain placeholder cards in the same carousel
often use their own fixed radius (e.g. 14px) tuned to the slot's actual
width, which is a *different* (usually larger) ratio — so the cover reads
as less rounded than its siblings even though nothing is technically wrong.

Apply press scale only to the outer boundary so the clip and content move as one unit
(shadow is no longer part of this concern).

**Radius value: prefer the exported ratio over a fixed literal.** Space
detail's round carousel first tried a fixed literal radius override (14px,
then 16px to match the full-size cover card) for its `CanonicalCardSlot`
covers and neighboring placeholder cards, matching the bug above literally. The
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
