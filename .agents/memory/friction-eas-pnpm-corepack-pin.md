---
name: EAS/corepack pnpm version pin
description: Why EAS build failed with ERR_PNPM_IGNORED_BUILDS despite correct onlyBuiltDependencies config, and how to verify the fix.
---

# Corepack resolves a different pnpm version than local unless pinned

Without a `packageManager` field in the root `package.json`, `corepack pnpm ...` resolves whatever the *latest* pnpm major is (observed: local dev pnpm was 10.26.1, but bare `corepack pnpm` resolved 11.18.0). EAS Build uses corepack, so it silently ran a newer major than local dev.

pnpm 11's build-script approval enforcement rejected an `onlyBuiltDependencies` entry (`esbuild`) that pnpm 10 accepted from the same `pnpm-workspace.yaml`, producing `ERR_PNPM_IGNORED_BUILDS` in EAS only — config looked correct, so it was easy to misdiagnose as a config bug rather than a version-drift bug.

**Fix:** add `"packageManager": "pnpm@<exact local version>"` to the root `package.json`. Corepack then pins to that exact version everywhere (local, EAS, CI).

**How to verify this class of bug pre-emptively:** run `corepack pnpm --version` vs `pnpm --version` — if they differ, corepack is drifting. To reproduce/confirm a pnpm-version-caused install failure without a full clone, copy just `package.json` + `pnpm-workspace.yaml` + `pnpm-lock.yaml` + `.npmrc` + every workspace member's `package.json` (preserving relative paths) into a scratch dir and run `CI=true corepack pnpm install --frozen-lockfile` there — much faster than tarring the whole repo (which can hit tmp disk-quota errors from `.pythonlibs`/`node_modules`).
