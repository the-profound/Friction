---
name: friction monorepo dev workflow
description: Non-obvious gotchas when changing the API contract or routes in the friction/api-server pnpm monorepo (codegen, restarts, type vs runtime).
---

# Friction / api-server dev workflow gotchas

## API contract changes start in openapi.yaml
`lib/api-spec/openapi.yaml` is the single source of truth. After editing it, run the
package's safe codegen script:

```bash
pnpm --filter @workspace/api-spec run codegen
```

**Critical yaml rules** — these patterns silently break the orval input resolver:
1. **No duplicate schema names** — having `SpaceInvitationWithSpace` defined twice causes "Failed to resolve input". Check with `grep -n "SchemaName:" openapi.yaml`.
2. **No bare `$ref + nullable: true`** at the same level on a schema *property* that itself contains an allOf-based type — use `allOf: [$ref: '…']` + `nullable: true` instead.
3. **Codegen generates flat files** (`api.ts`, `api.schemas.ts`) in `lib/api-client-react/src/generated/`. The safe wrapper preserves hand-written package barrels and creates the Zod public barrel.

After codegen, editing generated files directly is pointless — the safe wrapper replaces
both generated directories.

## Orval split output and Zod exports

Orval split output appends exports to package-level `src/index.ts` even when `target`
points inside `src/generated`. The safe codegen wrapper must snapshot and restore those
hand-written public barrels.

The Zod output also gives runtime validators and generated TypeScript models many of the
same names. Never star-export both trees. Generate a barrel that exports all validators
and only non-conflicting model types; same-named runtime validators take precedence.

**Why:** star-exporting both outputs causes TS2308 ambiguity, while explicitly
re-exporting a colliding type can make a validator import resolve as type-only.

**How to apply:** keep codegen entry points routed through the safe wrapper and verify
both generated packages with a forced declaration build immediately after regeneration.

## api-server does NOT hot-reload
The api-server workflow runs `build && start` (no watch). Any change to
`artifacts/api-server/src/**` — including route handlers — only takes effect after
**restarting the `artifacts/api-server: API Server` workflow**. Symptom of forgetting:
curl returns the old response shape (e.g. a newly-added field is missing).

## Types come from built declarations, runtime comes from src
Artifacts (e.g. `artifacts/friction`) consume `@workspace/*` two different ways:
- **Runtime**: Metro/tsx bundle directly from the `src` symlink in `node_modules`
  (package `exports` point at `./src/index.ts`). So a fresh codegen makes the new
  field work at runtime immediately (after a Metro reload), even if `tsc` still errors.
- **Types**: `tsconfig` uses **project references**, so `tsc` reads the referenced
  package's built `.d.ts`, NOT its src. After codegen you must run `tsc --build`
  (root script `typecheck:libs`) to refresh declarations, or `tsc --noEmit` will
  report phantom "Property X does not exist" errors for fields that exist in src.

## WebView 에디터 소스 수정 후 반드시 번들 재빌드
`components/WebViewMarkdownEditor/editorWebviewSrc/index.ts` 를 수정하면
반드시 `pnpm run build:editor` 로 `editorHtml.ts` 번들을 재빌드해야 한다.
소스만 수정하고 번들을 빌드하지 않으면 WebView는 이전 코드를 계속 실행한다.
Task 브랜치가 소스만 수정하고 머지될 경우 이 단계가 누락되므로, 머지 후 반드시 확인.

**Why:** Task #889 소스 수정 + 머지 후 번들 미재빌드로 인해 programmaticUpdatePending
fix가 적용되지 않아 본문 저장 버그가 지속됨. `grep programmaticUpdatePending editorHtml.ts`
count=0 이면 번들이 오래된 것.

## Pre-existing baselines (not your regression)
- `artifacts/friction` has ~31 baseline `tsc` errors confined to
  `components/WebViewMarkdownEditor/editorWebviewSrc/index.ts` (DOM `Node` typing
  conflicts). Unrelated to API work.

**Why:** these caused wasted time chasing "is this my bug?" — they are environmental
and orval/config-driven, present before any contract change.

## Pure layout tests must not import React Native tokens

Vitest's current web setup cannot parse React Native's Flow `import typeof` syntax when
a unit test imports a module that imports `react-native` transitively (such as
`constants/tokens`). Keep deterministic layout arithmetic in a platform-neutral module
and unit-test that module directly; let the React Native-facing layout adapter compose it
with tokens.

**Why:** importing the shared React Native token adapter made otherwise pure geometry
tests fail during module transformation before any assertions ran.

**How to apply:** for width/height/split calculations, keep the reusable math free of
React Native imports. Test the pure contract directly and use lightweight source-level
guards only for renderer wiring.
