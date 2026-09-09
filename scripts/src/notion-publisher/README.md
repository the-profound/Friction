# File-based Notion specification publisher

This module reads a UTF-8 Markdown file once, converts it locally into Notion
blocks, and publishes it through an injected authenticated transport. It never
accepts a Notion token and never logs the document body or complete database
URL.

## Public API

Use `publishMarkdownFile(transport, options)` from `publisher.ts`.

- `filePath` (required): Markdown file path
- `databaseUrl` or `databaseUrlEnv`: target DB; the environment variable
  defaults to `NOTION_QUEUE_DB_URL`
- `title`, `status`: optional overrides
- `mapping`: optional property mapping; the Queue defaults are `요청 제목`
  (title), `개발 상태` (status), and `개발 기록` (rich text)
- `sourceQueuePageUrl`: when it is a real URL, publishing fails closed so the
  existing Quick Writeback path updates the source page instead of creating a
  duplicate

The transport is deliberately thin. An authenticated Notion MCP adapter must
implement `NotionTransport`:

1. `fetchDatabase`: fetch only the data source ID and property names/types.
2. `findByDocumentKey`: search the mapped key property, or the
   `replit-spec:<document-key>:<content-hash>` marker in the mapped body
   property. Return the hash parsed from that marker.
3. `createPage`: create a page with properties and the first block batch.
4. `updatePage`: update properties and replace page content with the first
   batch. Do not append old content.
5. `appendBlocks`: append each remaining batch (at most 100 blocks).
6. `finalizePage`: store the final desired-state hash only after every body
   batch succeeds.
7. `verifyPage`: fetch only title, status, document key, and content hash.
8. `getRequestCount` (optional): report real HTTP requests; otherwise the
   publisher reports logical transport operations.

Authentication stays in the Replit Notion connection/MCP layer. Do not add
tokens to source, CLI arguments, adapter logs, or errors.
The connector proxy injects its compatible `Notion-Version` header; do not set
that header in the adapter.

## CLI

The CLI uses the installed Replit Notion connector by default. The connectors
SDK supplies and refreshes authentication without exposing a token. It prints
only the page URL and bounded metadata. `--adapter` remains available for an
MCP-hosted adapter module that exports `createNotionTransport`.

```sh
pnpm --filter @workspace/scripts notion:publish -- \
  --file .local/tasks/example.md \
  --database-url-env NOTION_QUEUE_DB_URL \
  --status "개발 완료"
```

For a non-Queue specification DB, pass a JSON mapping:

```sh
--mapping-json '{"title":"문서 이름","status":"작성 상태","body":"게시 식별자","documentKey":"문서 키","contentHash":"내용 해시"}'
```

The DB must already contain mapped properties of the correct types; this tool
never creates or changes database properties.

## Cost and idempotency

- Parsing, title extraction, hashing, and block conversion are deterministic
  local operations; no LLM call receives the source.
- The stable document key hashes the cleaned DB URL and canonical file path.
- A pending marker is stored before body writes and promoted to the final
  desired-state hash only after every block batch succeeds, so a retry repairs
  partial pages instead of treating them as complete.
- Schema and verified page metadata are cached for the current process.
- An identical second publish in the same process makes zero API calls.
- Across processes, one schema fetch and one key lookup establish idempotency.
- Changed content updates the existing page, batches blocks at the Notion
  request limit, and performs one minimal verification read.

Run local verification with:

```sh
pnpm --filter @workspace/scripts test:notion-publisher
pnpm --filter @workspace/scripts typecheck
```