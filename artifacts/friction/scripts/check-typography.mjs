#!/usr/bin/env node
/**
 * check-typography.mjs
 * Scans Friction app source for minimum-readability rule violations.
 *
 * Rules enforced:
 *   1. No direct Pretendard-ExtraLight / fontWeight "200" in component files
 *      (use Typography.bodyExtraLight or Typography.tabLabel tokens instead)
 *   2. No fontSize < 12 in UI component / app files
 *   3. No Colors.zinc300 or Colors.zinc400 used as text color
 *      (body/secondary text minimum is zinc500 / #71717a)
 *
 * Bypass: add `// typography-ok: <reason>` at the END of the offending line.
 *
 * Allowlisted paths (never checked):
 *   - constants/tokens.ts           (token definitions; tabLabel intentionally ExtraLight)
 *   - app/_layout.tsx               (font registration, not a style usage)
 *   - components/shared/bodyTypographyCss.ts   (reader WebView CSS, Eulyoo1945 body)
 *   - components/WebViewMarkdownEditor/        (editor WebView HTML/CSS)
 *   - components/WebViewMarkdownReader/        (reader WebView HTML/CSS)
 *   - scripts/                                 (tooling, not app code)
 *
 * Background:
 *   Pretendard ExtraLight (200) renders significantly thinner on native iOS/Android
 *   than in the browser. The combination of ExtraLight + small size + light gray
 *   fails on-device readability even when it looks fine in the web preview.
 *
 * Usage:
 *   node scripts/check-typography.mjs
 *   pnpm --filter @workspace/friction check:typography
 */

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = join(fileURLToPath(import.meta.url), "../..");
const SRC_DIRS = ["app", "components"].map((d) => join(ROOT, d));

const ALLOWLIST_FRAGMENTS = [
  "constants/tokens.ts",
  "app/_layout.tsx",
  "components/shared/bodyTypographyCss.ts",
  "components/WebViewMarkdownEditor",
  "components/WebViewMarkdownReader",
  "scripts/",
];

function isAllowlisted(relPath) {
  return ALLOWLIST_FRAGMENTS.some((p) => relPath.replaceAll("\\", "/").includes(p));
}

function collectFiles(dir, exts = [".tsx", ".ts"]) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, exts));
    } else if (exts.some((e) => entry.name.endsWith(e))) {
      results.push(full);
    }
  }
  return results;
}

const RULES = [
  {
    id: "extralight-direct",
    desc: 'Direct "Pretendard-ExtraLight" font family — use Typography.bodyExtraLight or Typography.tabLabel token instead',
    pattern: /fontFamily[^"']*["']Pretendard-ExtraLight["']/,
  },
  {
    id: "fontweight-200",
    desc: 'fontWeight "200" — minimum readable weight is Regular (400); use Typography.bodyExtraLight for large display only',
    pattern: /fontWeight\s*:\s*["']200["']/,
  },
  {
    id: "fontsize-below-12",
    desc: "fontSize below 12px — minimum UI text size is 12px (add typography-ok comment if space-constrained)",
    pattern: /fontSize\s*:\s*(\d+)/,
    test(match) {
      return parseInt(match[1], 10) < 12;
    },
  },
  {
    id: "text-color-zinc400",
    desc: "color: Colors.zinc400 — minimum body/secondary text color is zinc500 (#71717a); use typography-ok for placeholder/disabled/inactive",
    pattern: /\bcolor\s*:\s*Colors\.zinc400\b/,
  },
  {
    id: "text-color-zinc300",
    desc: "color: Colors.zinc300 — minimum body/secondary text color is zinc500 (#71717a); use typography-ok for decorative/border uses only",
    pattern: /\bcolor\s*:\s*Colors\.zinc300\b/,
  },
];

let violations = 0;
const allFiles = SRC_DIRS.flatMap((d) => {
  try {
    return collectFiles(d);
  } catch {
    return [];
  }
});

for (const file of allFiles) {
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  if (isAllowlisted(rel)) continue;

  const lines = readFileSync(file, "utf8").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip lines with bypass annotation
    if (/\/\/\s*typography-ok/.test(line)) continue;

    for (const rule of RULES) {
      const match = line.match(rule.pattern);
      if (!match) continue;
      if (rule.test && !rule.test(match)) continue;

      violations++;
      console.error(
        `\n[${rule.id}] ${rel}:${i + 1}` +
          `\n  ${line.trim()}` +
          `\n  → ${rule.desc}`,
      );
    }
  }
}

if (violations === 0) {
  console.log("✅  Typography check passed — no violations found.");
  process.exit(0);
} else {
  console.error(
    `\n❌  Typography check failed: ${violations} violation(s).\n` +
      `   Fix violations or add // typography-ok: <reason> to the end of the offending line.`,
  );
  process.exit(1);
}
