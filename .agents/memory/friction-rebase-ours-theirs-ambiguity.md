---
name: Rebase conflict tool ours/theirs labeling is unreliable
description: When resolving `<<<<<<< ours` / `>>>>>>> theirs` conflict markers produced by this project's automated rebase-conflict tool, do not assume a consistent mapping between "ours"/"theirs" and "my task's branch"/"main". Verify per file.
---

During a rebase-conflict resolution session (continueMergeResolution flow) for the friction app, the same two-file conflict pattern showed **opposite** ours/theirs mappings in different files of the *same* rebase:

- In one file, "ours" turned out to be the richer, already-merged main-branch code (e.g. a newer ConfirmModal/showToast UI from a separately merged task), and "theirs" was the rebasing task's own (older-based) commit content.
- In another file in the *same* rebase, "theirs" was the rebasing task's commit (with newer wording/SpaceCopy-key usage already applied), and "ours" was the plainer main-branch code.

**Why:** "ours"/"theirs" during `git rebase` refers to (target-being-rebased-onto) vs (commit-being-replayed), but which side has "more features" or "more recent-looking" text depends entirely on what unrelated tasks already merged into main for that specific file/function — it is not consistent across files in one rebase, and intuitions like "theirs looks newer so theirs=mine" are unreliable.

**How to apply:** For each conflicted function, read both full sides completely, identify concrete evidence of which one reflects already-merged main direction (e.g. cross-reference with `git show <target-sha>:<path>` or known merged task descriptions), then hand-merge: keep the side that reflects current main's structural/UX direction, and layer in only the wording/logic that is genuinely this task's deliverable. Don't resolve by pattern-matching marker labels alone.
