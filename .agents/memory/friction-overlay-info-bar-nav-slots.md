---
name: Overlay info-bar navigation slots (author/collection/space)
description: How CardSelectOverlay's bottom info-bar tap targets (author, collection, space) are structured so a new linkable entity can be added consistently.
---

The CardSelectOverlay bottom info bar shows author name and one shared
"collection line" text (used for either a personal collection name or a
space name — a letter is one or the other, never both). Each linkable
entity in that bar follows the same three-part contract:

1. An id field on the meta types (`ChainArticleMeta`, `LetterOverlayMeta`),
   e.g. `collectionId`, `spaceId`.
2. A `currentXId` suppression option (on `CardSelectOverlayProps` and
   `OpenLetterOverlayOptions`) — when the tapped letter's id matches the
   screen's own current entity id, the text renders as an inert `<Text>`
   instead of a `<Pressable>`. This is how "already inside this space/profile"
   screens correctly keep their own name non-tappable.
3. A `canTapX` boolean in CardSelectOverlay computed from
   `id && id !== currentXId && onNavigateToX`, then a ternary chain in the
   info-bar JSX: collection first, then space, else plain text (since only
   one of collectionId/spaceId is ever set per letter).

**Why:** this mirrors the pre-existing author-link mechanism exactly, so a
third mutually-exclusive linkable field (space) could be added without
touching the CardSelectOverlay's visual/animation code — only the data
plumbing needed to change.

**How to apply:** when adding a new tappable entity to this info bar (or
fixing one), search every screen that calls `openLetterOverlay(...)` and
check whether it derives the entity id from a `ViewModel` (built by a
`use*LetterCards.ts` hook) or from a `SendRecordWithDetails`-derived map
(`rec` from `buildSentLetterSourceMetadataByArticleId`) — Article's generated
type has no typed `spaceId`, so screens sourcing from raw `Article`/`vm`
objects must get the field added to their ViewModel builder function, while
screens already reading from `rec` can just add `rec.<field>` directly to
the meta object. Reply-chain ancestor slots (built from `useAncestorChain`'s
raw `Article` response) structurally cannot carry space info — that gap is
a known, accepted limitation, not a bug to work around locally.
