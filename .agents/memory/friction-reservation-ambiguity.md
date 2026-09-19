---
name: Friction reservation ambiguity (null vs cancelled vs withdrawn)
description: SpaceLetter.reservation:null is ambiguous between true-legacy and cancelled-only; how the API and UI each disambiguate it.
---

## API level: `reservation: null` doesn't mean "never scheduled"

`GET /spaces/:id/letters` computes `reservation` by picking the latest non-CANCELLED `space_scheduled_sends` row per letter (kept as-is for compatibility with `spaceRoundPresentation.ts` round-attribution logic used by `of-space-detail.tsx`). This means a letter whose *only* reservation history is CANCELLED gets `reservation: null` — indistinguishable from a genuine legacy letter that was never scheduled at all.

**Why it matters:** any client logic that treats `reservation === null` as "never scheduled, safe to treat like a normal always-visible item" (e.g. picking recent-letters for a space card) will incorrectly surface letters whose only send attempt was cancelled.

**How it was resolved:** added a purely additive `everScheduled: boolean` field to the `SpaceLetter` schema (openapi.yaml), computed from a `Set` of letter IDs that have *any* row at all in `space_scheduled_sends` regardless of status — no new query needed, built from the already-fetched reservation rows. Client candidate filters should treat a letter as true-legacy only when `reservation` is null **and** `everScheduled` is false/absent.

Also added an additive nullable `SpaceReservationMetadata.sentAt` (from `spaceScheduledSendsTable.sentAt`), distinct from the planned `scheduledAt`, for ordering by actual dispatch time rather than planned time when a reservation is SENT. Both fields are optional/non-required in the schema so they don't affect other endpoints that reuse `SpaceLetter`/`SpaceReservationMetadata` shapes (e.g. letter create/update responses) without populating them.

## Product/UI level: "never touched" vs "wrote it, then withdrew"

A slot-bound letter's current (non-cancelled) reservation state alone cannot tell a UI whether nobody has touched the slot yet, versus someone wrote a letter and deliberately cancelled its send — both look identical once the live reservation goes null.

**Why:** Losing that distinction lets a finished-and-withdrawn letter render as an untouched, urgent "do this now" prompt, even when the real deadline is still far away. Cancellation is a deliberate, meaningful user action and must stay legible in the UI, not collapse back into "nothing happened."

**How to apply:** Keep the finalized cancel behavior (current reservation state goes null) but retain the identity of the most-recent reservation of any status separately (`lastReservation`), so slot/letter presentation logic can recognize "withdrawn" as its own state, gated to the slot's own author, and never promote it into the normal active-letter grouping (which would double-render it or leak unsent content to other participants).
