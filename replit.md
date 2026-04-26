# Overview

This is a pnpm workspace monorepo utilizing TypeScript for a reading/writing platform. The project aims to provide a mobile application experience with a robust backend API.

The core business vision is to create a seamless experience for users to manage articles, personal collections, team collaborations, and interactions with other users through a mobile application. The platform supports features like article drafting, dividing, closing, and sending as 'letters', along with reading progress tracking and a sophisticated design system.

The project is structured to ensure maintainability, scalability, and developer efficiency through a monorepo setup, clear separation of concerns, and extensive use of TypeScript for type safety.

# User Preferences

### 에이전트 작업 절차

요청이 들어오면 작업을 시작하기 전에 아래 순서를 따른다.

1. **사용자 제공 스킬 확인** — `.agents/skills/` 아래 등록된 스킬 목록을 훑고, 이번 요청과 관련된 스킬이 있는지 판단한다.
2. **관련 스킬 읽기** — 관련 스킬이 있으면 해당 `SKILL.md`를 읽고 절차를 숙지한 뒤 작업을 시작한다.
3. **절차 준수** — 스킬에 명시된 단계·규칙·형식을 작업 전 과정에 걸쳐 지킨다.
4. **DB 규칙 준수** — Replit 내장 DB(database skill, Replit PostgreSQL)는 절대 사용하지 않는다. 모든 DB 작업은 `SUPABASE_DB_URL` 환경변수를 통해 Supabase에만 연결한다.

# System Architecture

The project is a pnpm workspace monorepo using TypeScript.

**Core Technologies:**
- **Node.js**: 24
- **Package Manager**: pnpm
- **TypeScript**: 5.9
- **API Framework**: Express 5
- **Database ORM**: Drizzle ORM for PostgreSQL
- **Validation**: Zod (v4) with `drizzle-zod`
- **API Codegen**: Orval for OpenAPI spec
- **Build Tool**: esbuild (CJS bundle)

**Monorepo Structure:**
- `artifacts/`: Deployable applications (e.g., `api-server`).
- `lib/`: Shared libraries including API specifications, React Query hooks, Zod schemas, and database configurations.
- `scripts/`: Utility scripts.

**TypeScript & Composite Projects:**
All packages extend a base `tsconfig.json` with `composite: true`, and the root `tsconfig.json` lists all packages as project references. Typechecking should always be run from the root to leverage the full dependency graph. `emitDeclarationOnly` is used for type checking, with actual JS bundling handled by esbuild/tsx/vite.

**API Server (`artifacts/api-server`):**
An Express 5 API server handling routes for users, articles, inbox, collections, stored sentences, reading progress, team collections, neighbors, and send records. It uses `@workspace/api-zod` for validation and `@workspace/db` for persistence.

**Database Layer (`lib/db`):**
Utilizes Drizzle ORM with PostgreSQL. Defines schemas for users, articles, inbox items, collections, stored sentences, reading records, team collections, neighbors, and send records. Migrations target Supabase PostgreSQL.

**API Specification & Codegen (`lib/api-spec`):**
Manages the OpenAPI 3.1 spec (`openapi.yaml`) and Orval configuration (`orval.config.ts`). It generates React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) from the OpenAPI spec.

**Mobile Application (`artifacts/friction` - Expo/React Native):**
A reading/writing platform mobile app built with Expo/React Native.

**UI/UX and Design System:**
- **Design Tokens**: `constants/tokens.ts` defines colors, typography, spacing, and reader-specific tokens (5:8 ratio, `cqi` type scale, serif/sans fonts).
- **Navigation**: Utilizes `NavigationContext.tsx` for global navigation state, syncing with Expo Router. Features a 4-tab bottom navigation bar (`NavBar.tsx`) and animated mini sub-tab bars.
- **Shared Components**: Includes `BottomSheet`, `ConfirmModal`, `SubmitButton` (with double-submit prevention), `ProgressIndicator`, `ArticleCardItem`, `ArticleListItem`, `CoverPreview`, `CoverEditor`, `MyArticlesPickerBottomSheet`, and `WebViewMarkdownEditor`. A `ToastContext.tsx` provides toast notifications.
- **Typography**: Reading screen (`read.tsx`) uses a 5:8 aspect ratio container with `cqi`-based dynamic typography (body 4.0cqi, caption 3.4cqi, metadata 2.8cqi), Noto Serif KR for body, and Noto Sans KR for UI text.

**Core Logic:**
- `lib/policies.ts`: Encapsulates 7 product policies (e.g., delivery hours, page limits).
- `lib/articleStatusCycle.ts`: Manages the DRAFT→DIVIDING→CLOSING→LETTER state machine for articles, including guards and status labels.
- `lib/pageDivision.ts`: Handles `---` based page splitting/merging, heading auto-split, safety zones, and validation.
- `lib/readingPersistence.ts`: Manages reading session state (IDLE→READING→PAUSED→COMPLETED_READY→COMMITTED) with exit blocking, page navigation, and progress calculation.
- `lib/deliverySync.ts`: Computes 06:00/18:00 KST delivery slots and implements sending guards.

**API-Integrated Hooks:**
- `lib/useAutoSave.ts`: Implements debounced auto-save with retry mechanisms.
- `lib/useArticleEditor.ts`: Combines auto-save with article status transitions via API.
- `lib/useReadingSession.ts`: Manages reading sessions with API-persisted position and completion commits.
- `lib/useSendArticle.ts`: Handles article sending flow with guards and API mutations.

**Screens:**
- **Tab Screens**: Inbox, Archive (personal/group/sentence), Outbox (neighbors/sent/send), Notes.
- **Detail Screens**: Settings, Reading screen, Neighbor list, Send letter, Send history, Personal/Team collection details, Sentence collection, DRAFT/DIVIDING/CLOSING editors, Memo collection.

# External Dependencies

- **Supabase**: Used for PostgreSQL database via `SUPABASE_DB_URL` environment variable and for authentication.
- **Orval**: API codegen from OpenAPI specification.
- **Drizzle ORM**: PostgreSQL ORM.
- **Zod**: Schema validation.
- **React Query**: For data fetching and caching in the React client.
- **Expo/React Native**: Mobile application development framework.
- **`expo-constants`**: Used for retrieving app version information.
- **`Linking.openURL` (from Expo)**: For opening external URLs for policy links.
- **TipTap HTML editor**: Integrated into `WebViewMarkdownEditor.tsx`.
- **Noto Serif KR / Noto Sans KR**: Font families used in the mobile application.