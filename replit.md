# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## 에이전트 작업 절차

요청이 들어오면 작업을 시작하기 전에 아래 순서를 따른다.

1. **사용자 제공 스킬 확인** — `.agents/skills/` 아래 등록된 스킬 목록을 훑고, 이번 요청과 관련된 스킬이 있는지 판단한다.
2. **관련 스킬 읽기** — 관련 스킬이 있으면 해당 `SKILL.md`를 읽고 절차를 숙지한 뒤 작업을 시작한다.
3. **절차 준수** — 스킬에 명시된 단계·규칙·형식을 작업 전 과정에 걸쳐 지킨다.
4. **DB 규칙 준수** — Replit 내장 DB(database skill, Replit PostgreSQL)는 절대 사용하지 않는다. 모든 DB 작업은 `SUPABASE_DB_URL` 환경변수를 통해 Supabase에만 연결한다.

현재 등록된 사용자 스킬 (`.agents/skills/`):
- **Notion2Replit** — Notion Queue DB 항목을 선택해 구현하고 결과를 Notion에 writeback
- **Replit2Notion** — 채팅 요청으로 개발을 완료한 뒤 결과를 Notion Queue DB에 역기록
- **expo-web-compat** — 화면·컴포넌트 신규 작성·수정 시 Web/iOS/Android 플랫폼 호환성 체크

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Structure

```text
artifacts-monorepo/
├── artifacts/              # Deployable applications
│   └── api-server/         # Express API server
├── lib/                    # Shared libraries
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/                # Utility scripts (single workspace package)
│   └── src/                # Individual .ts scripts, run via `pnpm --filter @workspace/scripts run <script>`
├── pnpm-workspace.yaml     # pnpm workspace (artifacts/*, lib/*, lib/integrations/*, scripts)
├── tsconfig.base.json      # Shared TS options (composite, bundler resolution, es2022)
├── tsconfig.json           # Root TS project references
└── package.json            # Root package with hoisted devDeps
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `artifacts/api-server` (`@workspace/api-server`)

Express 5 API server. Routes live in `src/routes/` and use `@workspace/api-zod` for request and response validation and `@workspace/db` for persistence.

- Entry: `src/index.ts` — reads `PORT`, starts Express
- App setup: `src/app.ts` — mounts CORS, JSON/urlencoded parsing, routes at `/api`
- Routes: `src/routes/index.ts` mounts sub-routers for all entities:
  - `health.ts` — `GET /api/healthz`
  - `users.ts` — CRUD for users
  - `articles.ts` — CRUD + status transitions (DRAFT→DIVIDING→CLOSING→LETTER), LETTER immutability guard
  - `inbox.ts` — List (filtered by visible_at <= now), open, mark read (creates UserArticleRead)
  - `my-collections.ts` — CRUD + article management (add/remove)
  - `stored-sentences.ts` — CRUD + favorite toggle
  - `reading.ts` — Upsert reading progress, create/check article completion records
  - `team-collections.ts` — CRUD + member management + article management (own articles only)
  - `neighbors.ts` — List, request/accept/reject workflow (userA < userB normalization)
  - `send-records.ts` — Send LETTER articles (auto-assigns 06:00/18:00 KST delivery slot, creates Inbox entry)
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run dev` — run the dev server
- `pnpm --filter @workspace/api-server run build` — production esbuild bundle (`dist/index.cjs`)
- Build bundles an allowlist of deps (express, cors, pg, drizzle-orm, zod, etc.) and externalizes the rest

### `lib/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL. Exports a Drizzle client instance and schema models.

- `src/index.ts` — creates a `Pool` + Drizzle instance, exports schema
- `src/schema/index.ts` — barrel re-export of all models
- `src/schema/<modelname>.ts` — table definitions with `drizzle-zod` insert schemas. 14 entities defined:
  - `users.ts` — users (id, email, nickname, avatarUrl, timestamps)
  - `articles.ts` — articles with status enum (DRAFT/DIVIDING/CLOSING/LETTER), pages JSON, style JSON, letterAt
  - `inbox.ts` — inbox items with visibleAt delivery gating, openedAt, isRead
  - `my-collections.ts` — personal collections + myCollectionArticles junction table
  - `stored-sentences.ts` — stored sentences with isFavorite, position JSON
  - `reading.ts` — readingRecords (progress) + userArticleReads (completion), both with (userId,articleId) unique constraints
  - `team-collections.ts` — team collections + memberships (OWNER/MEMBER) + teamCollectionArticles junction
  - `neighbors.ts` — neighbors (userAId < userBId normalization) + neighborRequests (PENDING status)
  - `send-records.ts` — send records with deliverySlot (06:00/18:00 KST)
- `drizzle.config.ts` — Drizzle Kit config (requires `SUPABASE_DB_URL` environment variable pointing to Supabase PostgreSQL)
- Exports: `.` (pool, db, schema), `./schema` (schema only)

Migrations target Supabase PostgreSQL via `SUPABASE_DB_URL`. In development, use `pnpm --filter @workspace/db run push`, with fallback to `pnpm --filter @workspace/db run push-force`.

### `lib/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and the Orval config (`orval.config.ts`). Running codegen produces output into two sibling packages:

1. `lib/api-client-react/src/generated/` — React Query hooks + fetch client
2. `lib/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `lib/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec (e.g. `HealthCheckResponse`). Used by `api-server` for response validation.

### `lib/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec (e.g. `useHealthCheck`, `healthCheck`).

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`. Scripts can import any workspace package (e.g., `@workspace/db`) by adding it as a dependency in `scripts/package.json`.

**Test accounts (Supabase Auth):** `pnpm --filter @workspace/scripts run seed-test-accounts` — 멱등하게 5명의 테스트 계정과 시드 데이터를 Supabase에 추가한다(기존 가입자는 보존, TRUNCATE 없음). 사전 조건: Supabase 대시보드 → Authentication → Providers → Email에서 **Confirm email 옵션을 OFF**로 설정해야 즉시 로그인 가능. 모든 비밀번호: `00000000`.

| 닉네임 | 이메일 | UUID |
|---|---|---|
| 민지 | minji@test.com | `92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f` |
| 하윤 | hayun@test.com | `5cd8e2ca-4463-47fa-a662-089884b2364d` |
| 서준 | seojun@test.com | `dfe2b6ed-31d8-46f9-b85f-7f7205e29fb7` |
| 지아 | jia@test.com | `934d1aa5-17d7-4afa-8d83-0181eae126d6` |
| 도윤 | doyun@test.com | `61c6386f-3aa8-4e72-acc1-69ab724e5f85` |

`UserContext.tsx`의 `FALLBACK_USER_ID`는 minji UUID로 설정되어 있어 웹 시뮬레이션(`DEV_WEB_BYPASS`)에서 minji 계정으로 동작한다. 기존 `seed.ts`는 TRUNCATE 기반이므로 운영 데이터가 있는 Supabase에는 실행 금지(로컬 헬륨 PG에서만 사용).

### `artifacts/friction` (Friction 1.0.0 — Expo/React Native)

Reading/writing platform mobile app. All 37 Notion Queue DB items processed (순서 1–11).

**Design system & navigation:**
- `constants/tokens.ts` — design tokens (Colors, Typography, Spacing, ReaderTokens with 5:8 ratio, cqi type scale, serif/sans fonts, cqiToPx/readerFontSize/readerLetterSpacing utils)
- `types/navigation.ts` — NavBar/SubTab/MiniSubTab type definitions
- `contexts/NavigationContext.tsx` — global navigation state (activeTab, layer, subTabs), syncs with Expo Router via useSegments/usePathname
- `components/NavBar/NavBar.tsx` — 4-tab bottom nav (IN/OF/TO/ON) + settings gear icon (→ /settings)
- `components/NavBar/PageHeader.tsx` — screen header with search/add actions
- `components/NavBar/MiniSubTabBar.tsx` — animated mini sub-tab bar for OF tab

**Shared components:**
- `components/BottomSheet/BottomSheet.tsx` — draggable bottom sheet with snap points
- `components/ConfirmModal/ConfirmModal.tsx` — confirmation dialog
- `components/ProgressIndicator/ProgressIndicator.tsx` — linear/circular progress
- `components/ArticleCardItem/ArticleCardItem.tsx` — 5:8 cover-style carousel card (330×528) with image/color/default background, title & author overlay
- `components/ArticleListItem/ArticleListItem.tsx` — list item with status badge
- `components/CoverPreview/CoverPreview.tsx` — cover preview using ArticleCover API type (image/color/default), renders title/author overlay with alignment and text color
- `components/CoverEditor/CoverEditor.tsx` — bottom sheet for cover editing (type, align, text color, bg color selection) with live preview, uses ArticleCover from @workspace/api-client-react
- `utils/articleCover.ts` — getDefaultCover() and resolveArticleCover() helpers for Article.cover field
- `components/MyArticlesPickerBottomSheet/MyArticlesPickerBottomSheet.tsx` — LETTER article picker
- `components/WebViewMarkdownEditor/WebViewMarkdownEditor.tsx` — TipTap HTML editor bridge
- `contexts/ToastContext.tsx` — toast notification system

**Core logic (pure business rules):**
- `lib/policies.ts` — 7 product policies (delivery hours, page limits, etc.)
- `lib/articleStatusCycle.ts` — DRAFT→DIVIDING→CLOSING→LETTER state machine with forward/back transitions, guards (title/content/empty page/red warning checks), status labels
- `lib/pageDivision.ts` — `---` based page split/merge, heading auto-split, safety zone (90%) + max char validation, empty page guard, red/yellow warning levels
- `lib/readingPersistence.ts` — basic/re_read session state machine (IDLE→READING→PAUSED→COMPLETED_READY→COMMITTED), exit blocking, page navigation, progress calc
- `lib/deliverySync.ts` — 06:00/18:00 KST slot computation, send guards (LETTER-only, no self-send, neighbor check), delivery time formatting

**API-integrated hooks:**
- `lib/useAutoSave.ts` — 1200ms debounce auto-save with idle/saving/saved/error states, exponential backoff retry (max 3), flush/retry controls
- `lib/useArticleEditor.ts` — combines useAutoSave + article status transitions via API, provides transitionForward/stepBack with guard validation
- `lib/useReadingSession.ts` — reading session with API-persisted position (debounced 2s), page navigation, completion commit via UserArticleRead API
- `lib/useSendArticle.ts` — send flow with guards + API mutation, returns expected delivery time

**Tab screens (app/(tabs)/):**
- `_layout.tsx` — 4-tab layout with NavigationProvider
- `index.tsx` (IN-00) — inbox with date carousel
- `of.tsx` (OF-00) — archive with 3 sub-tabs (personal/group/sentence)
- `to.tsx` (TO-00) — outbox with 3 sub-tabs (neighbors/sent/send)
- `on.tsx` (ON-00) — notes list with add button

**Detail/sub screens (app/):**
- `settings.tsx` (ST-01) — settings screen: 4 sections (Account/My Info/Policy/App Info), logout/delete account, user info via getUser API, policy links via Linking.openURL, app version from expo-constants
- `read.tsx` (READ-00) — reading screen with 5:8 aspect ratio container, cqi-based dynamic typography (body 4.0cqi, caption 3.4cqi, metadata 2.8cqi), serif (Noto Serif KR) body text, sans (Noto Sans KR) UI text, line-height 1.8, letter-spacing 0.05em
- `to-01.tsx` (TO-01) — neighbor list
- `to-02.tsx` (TO-02) — send letter screen
- `to-03.tsx` (TO-03) — send history
- `of-01.tsx` (OF-01) — personal collection list (mine/subscribed tabs)
- `of-02.tsx` (OF-02) — team collection list (mine/joined/subscribed tabs)
- `of-01-detail.tsx` (OF-01-D) — personal collection detail + visibility toggle
- `of-02-detail.tsx` (OF-02-D) — team collection detail + members tab
- `of-03.tsx` (OF-03) — sentence collection (all/favorites filter)
- `on-01a.tsx` (ON-01a) — DRAFT editor with auto-save
- `on-01b.tsx` (ON-01b) — DIVIDING page splitter with warnings
- `on-01c.tsx` (ON-01c) — CLOSING preview + export to LETTER, cover editor (type/align/text color/bg color), cover saved to Article.cover via API, virtual page 0 = cover preview
- `on-02.tsx` (ON-02) — memo collection with sort/manage mode
