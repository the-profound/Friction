---
name: friction-source-text-test-corruption
description: How a missing describe/it wrapper silently breaks an entire large source-text regression file, and how to spot it during unrelated refactors.
---

# Source-text regression test corruption from bad merges

Friction's regression tests for large components/screens often assert on
literal strings pulled from the component's own source (e.g.
`expect(overlay).toContain("Animated.timing(progress, {")`). These literal
assertions can be scattered across **multiple test files**, not just the one
named in a task's plan — e.g. a `CardSelectOverlay.tsx` literal string was
asserted in both its own `__tests__` folder and in an unrelated-looking
`lib/__tests__/bodyLayout.test.ts`. Always grep the whole test suite for the
literal strings/API calls you are about to change before a mechanism-swapping
refactor (e.g. `Animated.timing(progress` or `.stopAnimation(`), not just the
test file the task plan names.

Separately: a missing opening `describe(...)`/`it(...)` wrapper line (most
likely lost during a prior merge-conflict resolution) can leave a large block
of test body content sitting at module scope instead of nested — this breaks
**parsing of the entire file**, silently disabling every test in it (both
`vitest run` and `tsc --noEmit` fail to parse past that point). This is easy
to miss because the failure looks like "one file won't run" rather than
"one specific test is broken."

**Why:** in one investigation, `bodyLayout.test.ts` (~1200 lines, 40+ tests)
had been broken this way since a commit unrelated to the current task/prior
context — confirmed pre-existing by running `tsc`/`vitest` on `git stash`
(clean HEAD) and seeing the identical parse errors.

**How to apply:** if `vitest run`/`tsc --noEmit` throws a parse-level error
(`Declaration or statement expected`, `'}' expected`) in a file you touched
only cosmetically, do not assume you caused it — diff against `git stash`/HEAD
first. Fixing this class of corruption is usually out of scope for an
unrelated task (the missing content can be deep — e.g. helper variables used
before their own declaration inside the orphaned block, not just a two-line
fix) and is better reported as its own follow-up task than hand-patched
under time pressure.
