---
name: Friction reservation null vs cancelled-only ambiguity
description: SpaceLetter.reservation:null is ambiguous between true-legacy and cancelled-only reservations; how it was disambiguated.
---

`GET /spaces/:id/letters` computes `reservation` by picking the latest non-CANCELLED `space_scheduled_sends` row per letter (kept as-is for compatibility with `spaceRoundPresentation.ts` round-attribution logic used by `of-space-detail.tsx`). This means a letter whose *only* reservation history is CANCELLED gets `reservation: null` in the API response — indistinguishable from a genuine legacy letter that was never scheduled at all.

**Why it matters:** any client logic that treats `reservation === null` as "never scheduled, safe to treat like a normal always-visible item" (e.g. picking recent-letters for a space card) will incorrectly surface letters whose only send attempt was cancelled.

**How it was resolved:** added a purely additive `everScheduled: boolean` field to the `SpaceLetter` schema (openapi.yaml), computed from a `Set` of letter IDs that have *any* row at all in `space_scheduled_sends` regardless of status — no new query needed, built from the already-fetched reservation rows. Client candidate filters should treat a letter as true-legacy only when `reservation` is null **and** `everScheduled` is false/absent.

Also added an additive nullable `SpaceReservationMetadata.sentAt` (from `spaceScheduledSendsTable.sentAt`), distinct from the planned `scheduledAt`, for ordering by actual dispatch time rather than planned time when a reservation is SENT. Both fields are optional/non-required in the schema so they don't affect other endpoints that reuse `SpaceLetter`/`SpaceReservationMetadata` shapes (e.g. letter create/update responses) without populating them.
