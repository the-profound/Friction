---
name: Manual integration of two task branches
description: How to hand-merge two completed task branches into Friction's main when the platform auto-merge fails on overlapping files.
---

When the platform's automatic merge of two `[IMPLEMENTED]` task branches fails due to
overlapping file changes, integrate manually with this strategy:

1. Pick one branch as the base: set the working tree EQUAL to it (verify with
   `git --no-optional-locks diff <branch>` returning empty). Then you only have to
   layer the *second* branch on top.
2. Copy the second branch's UNIQUE files wholesale:
   `git --no-optional-locks show <branch>:<path> > <path>`. (Read-only `git show` is
   safe even when a stale `.git/index.lock` blocks index-touching git commands.)
3. Hand-merge only the genuinely SHARED files. For Friction the recurring ones are
   `lib/api-spec/openapi.yaml` (SSOT), `MEMORY.md`, and `CardSelectOverlay.tsx`.
   - NEVER hand-merge generated files (`lib/api-client-react`, `lib/api-zod`). Edit
     `openapi.yaml` then run `pnpm --filter @workspace/api-spec run codegen` (orval).
   - `CardSelectOverlay.tsx` has THREE `ArticleCardItem` call sites: envelope-layer
     (#874-only, leave alone), carousel-map, and single-card fallback. The carousel
     notice feature (`isNoticeOfDay`) belongs only on the latter two.
4. Rename colliding migration filenames (e.g. two `0015_*.sql`). These files are
   vestigial under the `drizzle-kit push` workflow, so the orphan/journal mismatch is
   harmless — the DB is synced via push, not migrate.
5. DB columns from task-agent work usually ALREADY exist in the shared Supabase DB
   (`SUPABASE_DB_URL`), because the agents tested against it. Verify with a read-only
   query before any push; no push is needed if columns are present.

**Why:** Friction's overlapping features touch the same overlay/spec/migration files,
so blind copy of one side silently drops the other's changes; codegen + Supabase
already-migrated state mean the safe path is spec-edit-then-regenerate and verify, not
hand-editing generated/DB artifacts.

**Note:** Body-supplied `requesterId` auth on the team-collection pin route is the
original feature design — preserve it during integration; don't "fix" it unless asked,
as that would regress the delivered feature content.
