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
5. **기존 컴포넌트 우선 활용** — 새 UI 요소를 만들기 전에 `artifacts/friction/components/`의 공용 컴포넌트(`BottomSheet`, `ConfirmModal`, `SubmitButton`, `ProgressIndicator`, `ArticleCardItem`, `ArticleListItem`, `CoverPreview`, `CoverEditor`, `WebViewMarkdownEditor` 등)를 먼저 확인하고, 재사용 가능한 컴포넌트가 있으면 새로 만들지 않고 기존 것을 활용한다.

### Plan Agent 커뮤니케이션

**계획 설명은 항상 한국어로** — Plan Agent가 태스크를 제안한 뒤 사용자에게 내용을 설명할 때는 쉬운 한국어로 요약해서 전달한다. 기술 용어는 필요한 경우에만 쓰되, 무엇을 왜 바꾸는지 / 완료 후 어떻게 달라지는지를 중심으로 설명한다.

### 실제 기기 회귀 검증

- iOS·Android 실제 기기에서 확인해야 하는 변경은 구현 작업과 검증 작업을 분리하지 않는다. 검증만을 목적으로 별도의 후속 작업을 만들지 말고, 해당 기능 작업의 `Done looks like`와 `Steps`에 대상 플랫폼·검증 범위·기대 결과·완료 조건을 함께 기록한다.
- 기기 또는 빌드 환경에 접근할 수 없어 검증하지 못한 경우에도 별도 검증 작업을 만들지 않는다. 같은 작업에 미검증 사유, 영향을 받는 플랫폼과 범위, 나중에 수행할 수동 확인 절차를 제한 사항으로 남긴다.
- 검증 중 실제 결함이 새로 발견된 경우에만 그 결함을 수정하기 위한 별도 작업을 만들 수 있다. 단순히 기기에서 다시 확인해야 한다는 이유만으로는 분리하지 않는다.

# Developer Setup

### iOS TestFlight 배포 트랙

Friction은 SDK 56 / RN 0.85 기반이며, TestFlight을 통해 두 가지 빌드 트랙을 배포합니다.

| 트랙 | 용도 | 명령 |
|------|------|------|
| **dev-client** | 엔지니어용 — Metro 연결, 실시간 코드 리로드 | `bash artifacts/friction/scripts/publish-dev.sh` |
| **preview** | 베타 테스터용 — JS 번들 내장, 완성품 경험 | `bash artifacts/friction/scripts/publish-preview.sh` |
| **production** | App Store 배포 | `bash artifacts/friction/scripts/publish-ios.sh` |

#### dev-client 빌드 사용법 (엔지니어)

1. `bash artifacts/friction/scripts/publish-dev.sh` 로 TestFlight에 dev-client 빌드 배포 (최초 1회)
2. 기기에서 TestFlight → Friction(dev) 설치
3. Replit에서 코드 수정 중 터미널에서 `pnpm --filter @workspace/friction dev:tunnel` 실행
4. 앱을 열면 "Enter URL manually" 화면이 나타남 — 고정 ngrok 주소(처음 한 번만 입력하면 됨) 입력
5. 이후 Replit 세션이 바뀌어도 같은 주소로 자동 연결됨

> **고정 주소**: `$NGROK_STATIC_DOMAIN` 환경 변수에 저장된 도메인입니다.
> ngrok 무료 계정 1개당 정적 도메인 1개 — 세션이 바뀌어도 주소는 변하지 않습니다.

#### EAS 빌드 프로필 (`eas.json`)

- `development` — `developmentClient: true`, store distribution → TestFlight 내부 테스터
- `preview` — JS 번들 내장(production과 동일 번들링), store distribution → TestFlight 베타 테스터  
- `production` — App Store 제출용

### 개발 데이터 세팅 (최초 1회)

API 서버는 시드 데이터를 서버 시작 시 자동으로 주입하지 않습니다.  
새 환경에서 처음 개발할 때 아래 커맨드를 **한 번** 실행하세요:

```bash
pnpm --filter @workspace/api-server seed
```

- 시드는 idempotent(멱등)합니다 — 이미 적용됐으면 건너뜁니다.
- 테스트 컬렉션: `하윤이네 모임` (2d9417a7-...)
- 개발 bypass 유저: 민지 dev (`DEV_WEB_BYPASS_USER_ID = 92d8bf9b-...`, `_layout.tsx` 참고)

### 유닛 테스트 실행

```bash
pnpm --filter @workspace/friction test
```

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