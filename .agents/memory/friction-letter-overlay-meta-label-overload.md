---
name: CardSelectOverlay ChainArticleMeta label overload
description: Why the overlay's "collection/space" label and card-cover collectionName/spaceName props can silently show wrong or redundant info when a caller passes the wrong source field.
---

# Overlay meta label is one shared field, routed by which ID is set

`ChainArticleMeta.collectionName` (in `CardSelectOverlay.tsx` /
`useLetterSelectionOverlay.tsx`) is a single overloaded display label, not
literally "the collection's name". The info bar renders whatever string is in
`collectionName`, but decides the *tap target* by which ID accompanies it:
`collectionId` set (and different from `currentCollectionId`) routes to
`onNavigateToCollection`; otherwise `spaceId` set (and different from
`currentSpaceId`) routes to `onNavigateToSpace`; otherwise it's plain
non-tappable text. So to show a Space name with a working link, callers must
put the space name in `collectionName`, leave `collectionId` null, and set
`spaceId` — not the other way around.

Separately, `ArticleCardCover` (used by `ArticleCardItem`) accepts
`collectionName` and `spaceName` as two independent props: `spaceName` wins as
the primary line, and `collectionName` only renders as a smaller secondary
line when it differs from `spaceName`. Passing a screen's own
"first-added-collection" value (`vm.collectionName`, resolved server-side to
whichever personal/team collection an article was earliest added to) as
`collectionName` on a screen that itself IS that same collection produces a
redundant/confusing third line — pass only `spaceName` in that case.

**Why:** on `artifacts/friction/app/of-01-detail.tsx`'s 3-column grid, passing
`collection?.name` (the currently-browsed collection's own name) as the
overlay's `collectionName` — with `collectionId` equal to
`currentCollectionId` and no `spaceId` at all — produced a cover that showed
the browsing collection's own name instead of the letter's actual origin
Space, with the label permanently non-tappable (both the collectionId route
disabled by the self-match guard and the spaceId route never enabled).

**How to apply:** when opening `CardSelectOverlay` for a letter that has a
known origin Space (via `myArticleToViewModel`'s `spaceName`/`spaceId`),
prefer `collectionName: vm.spaceName ?? <fallback collection name>`,
`collectionId: vm.spaceName ? null : <fallback collection id>`,
`spaceId: vm.spaceId ?? null`. For the card's own cover, pass only
`spaceName` when a per-collection screen would otherwise repeat its own name.
