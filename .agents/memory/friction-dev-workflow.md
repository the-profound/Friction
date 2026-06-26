---
name: friction monorepo dev workflow
description: Non-obvious gotchas when changing the API contract or routes in the friction/api-server pnpm monorepo (codegen, restarts, type vs runtime).
---

# Friction / api-server dev workflow gotchas

## API contract changes start in openapi.yaml
`lib/api-spec/openapi.yaml` is the single source of truth. After editing it, run
`pnpm --filter @workspace/api-spec run codegen` (orval) to regenerate BOTH
`lib/api-zod` and `lib/api-client-react`. Editing the generated files directly is
pointless — codegen with `clean: true` wipes them.

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
- `lib/api-zod` declaration build fails with TS2308 duplicate-export ambiguity
  (`src/index.ts` does `export * from "./generated/api"` AND `"./generated/types"`,
  which collide). This means `typecheck:libs` / api-server `tsc --noEmit` always
  surfaces TS6305 "dist/index.d.ts has not been built" for api-zod. Baseline, runtime
  unaffected (api-server runs via tsx from src).
- `artifacts/friction` has ~31 baseline `tsc` errors confined to
  `components/WebViewMarkdownEditor/editorWebviewSrc/index.ts` (DOM `Node` typing
  conflicts). Unrelated to API work.

**Why:** these caused wasted time chasing "is this my bug?" — they are environmental
and orval/config-driven, present before any contract change.
