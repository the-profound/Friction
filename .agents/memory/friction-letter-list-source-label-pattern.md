---
name: Friction letter-list source-label pattern
description: Shared pattern for computing "is this letter public/recipient-only" and its source label across every screen that lists sent letters.
---

Every screen that lists a user's sent letters (편지 탭, 프로필, 수신자만 볼 수 있는 편지, etc.)
needs two things computed consistently:

1. **Visibility / inclusion**: `spaceLetterByArticleId` (from `useLetterSelectionOverlay`)
   already applies "PUBLIC wins" — if ANY space_letter for an article is PUBLIC, the map
   entry is PUBLIC; only if ALL are RECIPIENT_ONLY does it resolve to RECIPIENT_ONLY.
   Personal/reply sends never create a space_letter row and are unconditionally
   recipient-only (no visibility toggle exists for them) — detect them with
   `isSpaceSendRecord()` from `lib/sentLetterVisibility.ts` over the raw send-records list
   (not the deduped per-article map), since one article can have both a space send and a
   personal send.

2. **Source label** (모음명/공간명 shown on the card and in the overlay info bar):
   `buildSentLetterSourceMetadataByArticleId(sendRecords)` picks one "primary" record per
   article (space-sent preferred over personal via `compareSendRecords`) and returns
   `{ name, collectionId, spaceId, deliverySlot }`. Always apply it as
   `sendRecordByArticleId[article.id]?.name ?? vm.collectionName` — never trust the
   ViewModel's bare `collectionName`/`spaceName` alone, or personal-sent letters render a
   blank label.

**Why:** these two computations look like small filters, but skipping the "PUBLIC wins"
rule readmits already-public letters into a recipient-only list, and skipping the
send-record label fallback silently blanks out personal-send cards. Both bugs are only
visible with live data, not from static review.

**How to apply:** when adding or auditing any new sent-letter list screen, reuse
`spaceLetterByArticleId` + `buildSentLetterSourceMetadataByArticleId` +
`isSpaceSendRecord` exactly as `app/(tabs)/to.tsx` and
`app/user-profile/[userId].tsx` do, rather than re-deriving visibility/label logic
per screen.
