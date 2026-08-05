---
name: Per-round letter scoping pattern (OPENING/CENTER)
description: How space-round-scoped reservation constraints (duplicate prevention, date limits, article reuse) must be wired consistently across backend and frontend for any per-round SpaceLetter type.
---

# Per-round letter scoping pattern

`spaceLettersTable.spaceRoundId` is the scoping key for anything that must be
"one per round" (CENTER already worked this way; OPENING was added in the
same pattern). When adding a new per-round letter constraint, all of these
must move together or the constraint silently doesn't hold:

1. **Article-reuse matching** (`POST /spaces/:id/letters`) must include
   `spaceRoundId` in the lookup `and(...)` (using `isNull` when absent) —
   otherwise reusing an article across two different rounds' letters
   incorrectly returns the other round's row.
2. **Duplicate-reservation check** in the scheduled-sends routes groups by
   `authorId + letterType + spaceRoundId` — already round-scoped generically,
   so a new letter type gets this for free as long as (1) is correct.
3. **Date validation** needs its own per-type helper (e.g.
   `validateCenterSlotDate` / `validateOpeningRoundDate`) called from *both*
   the POST and PATCH scheduled-send routes — easy to add to only one route
   by mistake.
4. **Frontend cancellation-on-create scope** (e.g. cancel existing PENDING
   sends of the same letter type before creating a new one) must filter to
   the same round, not the whole space.
5. **Frontend eligibility lists** (e.g. "which slots can still be reserved")
   must be computed per-round from the rounds list + existing sends, not as a
   single space-wide boolean.

**Why:** OPENING letters were originally implemented as "one per space"
(space-wide taken/not-taken flag) while CENTER was already "one per round" —
extending OPENING to match CENTER touched all 5 of the above call sites; a
partial fix (e.g. just the date validation) would leave duplicate/reuse bugs.

**How to apply:** When asked to make any letter type round-scoped or add a
per-round date/quantity constraint, grep all 5 call-site categories above
(reuse matching, dup-check grouping, POST+PATCH validation, cancellation
scope, frontend eligibility) rather than only the one the request mentions.
