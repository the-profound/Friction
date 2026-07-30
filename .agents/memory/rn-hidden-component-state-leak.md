---
name: RN hidden-component state leak
description: Components that return null when hidden still retain hook state — transient interaction state must be explicitly reset on close, open, and key prop changes.
---

# RN hidden-component state leak

## The rule
A component that conditionally renders `if (!visible) return null` still keeps all its hook state alive between hidden/visible transitions. Any transient interaction state (edit mode, swipe-open card, optimistic deletions) must be explicitly reset in three places:

1. **On open** — in the `visible → true` branch of a `useEffect([visible])`
2. **On close** — at the top of the close handler (before the animation), not inside `finished` callback
3. **On key prop change** — a separate `useEffect([propThatChangesContext])` that resets if currently visible

## Why
If a user enters edit mode in context A, closes the sheet, then opens it for context B, the stale `editingThought` state persists. Submitting then patches a thought in A while the user thinks they're creating in B — a silent cross-context data mutation.

## How to apply
- Group all transient state resets into a `resetTransientState` callback
- Call it from doClose (immediately, not in animation callback), from the open branch, and from the context-change effect
- Additionally guard the send/submit handler: verify that the editing target still belongs to the current context (`editingThought.sourceArticleId === articleId`), and fall back to create if not

## Example (ThoughtsBottomSheet)
```ts
const resetTransientState = useCallback(() => {
  setEditingThought(null);
  setOpenCardId(null);
  setDeletedIds(new Set());
}, []);

// On open:
useEffect(() => { if (visible) { resetTransientState(); ... } }, [visible]);

// On article change:
useEffect(() => { if (visible) resetTransientState(); }, [articleId]);

// In doClose (before animation):
setEditingThought(null); setOpenCardId(null); setDeletedIds(new Set());

// In handleSend guard:
const isValidEdit = editingThought != null && editingThought.sourceArticleId === articleId;
```
