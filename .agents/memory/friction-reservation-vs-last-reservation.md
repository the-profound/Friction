---
name: reservation vs lastReservation on SpaceLetter
description: Product decision for telling "never touched this slot" apart from "wrote a letter, then withdrew its send" without resurrecting a cancelled send as active.
---

A slot-bound letter's current (non-cancelled) reservation state alone cannot
tell a UI whether nobody has touched the slot yet, versus someone wrote a
letter and deliberately cancelled its send — both look identical once the
live reservation goes null.

**Why:** Losing that distinction lets a finished-and-withdrawn letter render
as an untouched, urgent "do this now" prompt, even when the real deadline is
still far away. Cancellation is a deliberate, meaningful user action and must
stay legible in the UI, not collapse back into "nothing happened."

**How to apply:** Keep the finalized cancel behavior (current reservation
state goes null) but retain the identity of the most-recent reservation of
any status separately, so slot/letter presentation logic can recognize
"withdrawn" as its own state, gated to the slot's own author, and never
promote it into the normal active-letter grouping (which would double-render
it or leak unsent content to other participants).
