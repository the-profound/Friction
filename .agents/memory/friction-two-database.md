---
name: Friction two-database setup
description: executeSql hits local DB only; API server uses Supabase DB. Migrations must reach both.
---

# Friction two-database setup

The project uses two separate PostgreSQL databases:

| Variable | Used by | Notes |
|---|---|---|
| `DATABASE_URL` | `executeSql` code-execution tool, local dev tools | Local Replit Postgres |
| `SUPABASE_DB_URL` | `@workspace/db` (api-server runtime) | Supabase Postgres, takes priority in `lib/db/src/index.ts` |

**Why:** `lib/db/src/index.ts` picks `SUPABASE_DB_URL ?? DATABASE_URL`. The `executeSql` sandbox only has `DATABASE_URL` in scope.

**How to apply:** When running DB migrations, `executeSql` alone is NOT enough — it only touches the local DB. To apply changes to the Supabase DB, compile a CJS migration script with esbuild and run via Node:

```bash
# 1. Write migration in artifacts/api-server/src/migrate-xxx.ts (imports from @workspace/db)
# 2. Build:
cd artifacts/api-server
pnpm exec esbuild src/migrate-xxx.ts --bundle --platform=node --format=cjs --outfile=dist/migrate-xxx.cjs
# 3. Run:
node dist/migrate-xxx.cjs
# 4. Clean up the temp files
```

drizzle-kit push also reaches the Supabase DB (it uses SUPABASE_DB_URL) but is interactive — pipe newlines to accept defaults or use --force. It may still ask rename-vs-create questions that need manual selection.

**Symptom of missing migration on Supabase:** Drizzle `queryWithCache` throws `Error: Failed query: ...` (wrapping real PG error in `cause`). Direct `executeSql` tests pass (wrong DB). Server returns 500 on the affected endpoint.

**SUPABASE_DB_URL quirk:** the secret has no `postgresql://` scheme prefix (lib/db prepends it), so bare `psql "$SUPABASE_DB_URL"` fails to parse. For ad-hoc queries, use a node script with `pg` from `lib/db/node_modules`, prepending the scheme like lib/db does.
