# Overview

This is a pnpm workspace monorepo using TypeScript, designed for a reading/writing platform. The project aims to provide a robust API server, shared libraries, and a mobile application (Friction) for content creation, consumption, and social interaction.

The core business vision is to enable users to create and manage articles, send them to neighbors, and track reading progress. It integrates with external services like Supabase for database management and authentication. The mobile application focuses on a rich UI/UX for reading and editing, with features like article status transitions, page splitting, and cover customization.

# User Preferences

When a request is received, before starting work, follow these steps:

1.  **Check User-Provided Skills** — Scan the list of skills registered under `.agents/skills/` and determine if any are relevant to the current request.
2.  **Read Relevant Skill** — If a relevant skill exists, read its `SKILL.md` to understand the procedure, then begin work.
3.  **Adhere to Procedure** — Follow the steps, rules, and formats specified in the skill throughout the entire work process.
4.  **Adhere to DB Rules** — Absolutely do not use the Replit built-in DB (database skill, Replit PostgreSQL). All DB operations must connect only to Supabase via the `SUPABASE_DB_URL` environment variable.

Current registered user skills (`.agents/skills/`):
-   **Notion2Replit** — Select a Notion Queue DB item to implement and write back results to Notion.
-   **Replit2Notion** — After completing development based on a chat request, record the results in the Notion Queue DB.
-   **expo-web-compat** — Check Web/iOS/Android platform compatibility when creating or modifying new screens/components.

# System Architecture

The project is structured as a pnpm workspace monorepo with TypeScript. It uses Node.js 24 and pnpm as the package manager.

**UI/UX Decisions (Friction App):**
The mobile application, "Friction," uses a detailed design system with specific design tokens for Colors, Typography, Spacing, and ReaderTokens, ensuring a consistent visual experience. It implements a 4-tab bottom navigation (IN/OF/TO/ON) and various sub-tabs, managed by a global navigation context. Key UI components include a draggable bottom sheet, confirmation modals, progress indicators, and specialized article cards/lists. Typography is dynamic and cqi-based, utilizing Noto Serif KR for body text and Noto Sans KR for UI text.

**Technical Implementations & Feature Specifications:**

-   **API Server (`artifacts/api-server`):** An Express 5 server handling CRUD operations for users, articles, inbox, collections, stored sentences, reading progress, and neighbors. It includes specific logic for article status transitions (DRAFT→DIVIDING→CLOSING→LETTER) and a guard for LETTER immutability. Sending articles involves auto-assigning delivery slots (06:00/18:00 KST).
-   **Database Layer (`lib/db`):** Uses Drizzle ORM with PostgreSQL, supporting 14 entities including users, articles (with status enum), inbox items, various collections, stored sentences, reading records, and neighbor relationships. Migrations target Supabase PostgreSQL.
-   **API Codegen (`lib/api-spec`):** Manages the OpenAPI 3.1 specification and uses Orval to generate React Query hooks (`lib/api-client-react`) and Zod schemas (`lib/api-zod`) for API interaction and validation.
-   **Core Application Logic (Friction App):**
    -   **Policies:** Implements 7 product policies covering delivery hours, page limits, etc.
    -   **Article Status Cycle:** A state machine managing article transitions (DRAFT→DIVIDING→CLOSING→LETTER) with guards for content validation.
    -   **Page Division:** Handles `---` based page splitting and merging, heading auto-splitting, and content validation (safety zone, max characters).
    -   **Reading Persistence:** Manages reading sessions, page navigation, and progress calculation with API persistence.
    -   **Delivery Sync:** Computes KST delivery slots and implements guards for article sending.
-   **API-Integrated Hooks (Friction App):** Includes `useAutoSave` (with debounce and retry logic), `useArticleEditor` (combining auto-save and status transitions), `useReadingSession` (for debounced progress persistence), and `useSendArticle` (for the article sending flow).
-   **Editor Components (Friction App):** Features a WebView Markdown Editor for content creation and a Cover Editor for customizing article covers (type, alignment, text/background color).
-   **Typechecking:** Uses TypeScript composite projects, requiring typechecking from the root (`pnpm run typecheck`) to ensure cross-package import resolution. `emitDeclarationOnly` is used for declaration file generation, with actual JS bundling handled by esbuild/tsx/vite.

# External Dependencies

-   **Database:** PostgreSQL (specifically Supabase PostgreSQL)
-   **ORM:** Drizzle ORM
-   **Validation:** Zod (`zod/v4`), `drizzle-zod`
-   **API Codegen:** Orval (from OpenAPI spec)
-   **Authentication:** Supabase Auth (for test accounts, with email confirmation optionally off)
-   **Mobile App Framework:** Expo/React Native (for "Friction" app)
-   **HTTP Client/Query Management:** React Query (for generated API client hooks)
-   **Build Tool:** esbuild (for CJS bundle of API server)
-   **Utility Scripts:** `tsx`
-   **UI Components:** TipTap (for WebViewMarkdownEditor)
-   **OS Integration:** `expo-constants`, `Linking` (for policy links)