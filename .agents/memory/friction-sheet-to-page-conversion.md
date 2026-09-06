---
name: Bottom-sheet-to-full-page conversion pattern
description: Durable pitfalls when turning a dimmed bottom-sheet editor into its own always-expanded page, keyed on the origin screen's cache-derived state and a mount-time initialization race.
---

When a task turns a dimmed bottom-sheet editor into a dedicated full page:

- Do not keep the origin screen's local copy of the edited entity synced via
  staged snapshots. Derive it every render straight from the query cache
  instead, so it can never drift from what the edit page actually saved.
- **Mount-time initialization race:** if the new page fetches the entity
  itself and only learns its real value asynchronously, do not seed the
  edited value's React state with a placeholder/default and "correct" it in
  an effect. An effect runs one render *after* the state read it, so a child
  editor component that captures its own local copy at mount can capture the
  placeholder instead of the real value — and then save the placeholder over
  a real, already-saved value. Seed the state as `null`/absent, initialize it
  synchronously via a lazy `useState` initializer from a value already in the
  cache when available, and gate rendering of the editor and its live preview
  on that state being resolved (not merely on the entity fetch finishing).
- Route back-navigation through one async handler that awaits any pending
  save's flush before navigating back, so the origin screen's next read of
  the cache reflects the final value.
- A transient in-progress flag that must still gate an action on the
  *origin* screen, even though the real work now happens only on the new
  page, is a good fit for a tiny cross-screen subscribable singleton keyed by
  entity id — cheaper than threading state through navigation params.
