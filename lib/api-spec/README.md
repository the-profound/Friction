# @workspace/api-spec

OpenAPI specification and codegen configuration for the Friction API.

## Files

- `openapi.yaml` — Single source of truth for all API schemas and endpoints.
- `orval.config.ts` — Orval codegen configuration that targets two output packages.

## Codegen

**After any change to `openapi.yaml`, you must re-run codegen.** The generated files in `lib/api-client-react/src/generated/` and `lib/api-zod/src/generated/` are fully derived from the spec and must not be edited by hand.

```bash
pnpm --filter @workspace/api-spec run codegen
```

This regenerates:
- `lib/api-client-react/src/generated/` — React Query hooks and fetch helpers
- `lib/api-zod/src/generated/` — Zod validators, TypeScript types, and a public
  barrel that prioritizes runtime validators and re-exports non-conflicting
  generated model types

The safe codegen wrapper also preserves each package's hand-written `src/index.ts`;
Orval's split output must not append generated star exports to those public barrels.

## Rule

> **Whenever you add or change a field in `openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before committing.**
