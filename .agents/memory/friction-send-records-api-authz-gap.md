---
name: send-records API authorization gap
description: GET /send-records is unauthenticated and keyed only by senderId query param; any recipient-only flag must be enforced server-side there, not just filtered client-side.
---

`GET /send-records` and `GET /send-records/:id` in the api-server take no auth — they're queried directly by `senderId` (e.g. from another user's public profile screen via `useListSendRecords({ senderId: profileUserId })`). Client-side visibility helpers (e.g. in `sentLetterVisibility.ts`) are not an authorization boundary: anyone can call the endpoint directly and see full records including embedded article/recipient data.

**Why:** a code review caught this when a new recipient-only privacy flag (`isAnonymousSpaceReply`) was added to send_records but only filtered in the two consuming screens, leaving the raw API freely enumerable.

**How to apply:** when adding or relying on any "recipient-only" / "hidden from public profile" attribute on send_records, enforce it inside the route via `resolveCallerId(req)` compared against the record's `senderId` — return 404 for `/:id` and strip from the list for the list endpoint — in addition to (not instead of) client-side filtering.
