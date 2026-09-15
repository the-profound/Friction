---
name: Friction 3-column card cover metadata source by screen type
description: Which helper to reuse for a 3-col ArticleCardItem grid's authorName/collectionName/spaceName, and the anonymous-identity masking trap that only bites when a grid can show someone else's letter.
---

Three different helpers populate the same ArticleCardItem props (`authorName`, `collectionName`, `spaceName`), and using the wrong one for a screen either shows the wrong label or throws away data the API already returns:

- **Sent-letter lists** (마이 탭 편지 목록, 수신자만 볼 수 있는 편지 탭) — the label should be the *send record's* target name (space or personal-collection the letter was actually delivered through), not the article's own `collectionName`. Use `buildSentLetterSourceMetadataByArticleId` + `isSpaceSendRecord` (see `friction-letter-list-source-label-pattern.md`), falling back to the article-derived viewmodel only when no send record exists.
- **Personal-collection detail grids** (of-01-detail.tsx, i.e. 보관함 개인 모음 상세) — there is no "send record" concept; every entry is just an `Article`. Reuse `myArticleToViewModel(article, spaceLetterByArticleId.get(article.id) ?? null)` from `hooks/useMyLetterCards.ts`.
- **Profile / public article lists** — use `profileArticleToViewModel` instead (reads `article.spaceName` directly since profile responses don't include per-user SpaceLetter rows).

**Why:** picking the wrong helper either shows a stale/generic name (using the raw article fields on a sent-letter screen skips the send-time override) or crashes/no-ops (send-record helpers expect a `SendRecordWithDetails[]` array the personal-collection screen never fetches).

**How to apply:** before wiring a new 3-column grid's cover metadata, identify whether the underlying list is "articles the current user sent" (has send records) vs "articles sitting in a collection/profile" (no send records), and pick the matching helper above instead of inventing a fourth mapping.

## Anonymous-identity masking trap (foreign-authored letters)

`myArticleToViewModel`/`profileArticleToViewModel` were both written for lists that are always self-authored (마이 탭, your own profile) or already server-masked. The trap: a screen that reuses one of these helpers for a list that *can* contain someone else's letter (e.g. "인상깊은 편지" personal collections, which admit foreign-authored articles) inherits **no** anonymous-Space protection, because the raw endpoint backing that helper (`GET /my-collections/:id/articles`, `GET /articles`, etc.) historically just joined `usersTable.nickname` directly with no masking — unlike the space-scoped endpoints (`GET /spaces/:id/letters`, `GET /users/:id/space-letters`), which already compute a safe per-Space alias server-side.

**Why:** a foreign-authored letter that reached an anonymous Space must never reveal the real author's nickname to someone who isn't supposed to know who wrote it, even indirectly through a "view author profile" link — exposing the raw `authorId` is just as much a leak as showing the real nickname, since the client can resolve nickname from ID separately.

**How to apply:** before wiring a screen's foreign-authored-letter cover/overlay to `authorName`/`authorId`, confirm whether the backing endpoint already does anonymous-Space masking (space-scoped endpoints do; general article/collection endpoints originally didn't). If not, add masking at the endpoint (resolve `space_letters`/`spaces.is_anonymous`/`space_participations.space_nickname` for the article, mirroring `anonymousSpaceIdentity.ts`'s pattern), have it return both the safe display name and an explicit `authorIdentityMasked` boolean, and have the client null out `authorId` for the overlay/navigation meta whenever that boolean is true — never infer masking from the display name alone.
