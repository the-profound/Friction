#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();

// Development 프로필 및 non-release 환경에서는 네이티브 static bundle 검사 스킵
if (
  process.env.EAS_BUILD_PROFILE === "development" ||
  process.env.APP_VARIANT === "development" ||
  !["preview", "test", "production"].includes(process.env.EAS_BUILD_PROFILE ?? "")
) {
  console.log("Skipping EAS bundle validation for development/non-release profile.");
  process.exit(0);
}

const expectedValues = [
  process.env.EXPO_PUBLIC_SUPABASE_URL,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  process.env.EXPO_PUBLIC_DOMAIN,
  process.env.EXPO_PUBLIC_POSTHOG_HOST,
  process.env.EXPO_PUBLIC_POSTHOG_TOKEN,
].filter(Boolean);

const bundleNames = new Set([
  "main.jsbundle",
  "index.android.bundle",
  "index.ios.bundle",
  "bundle.js",
]);
const ignoredDirectories = new Set(["node_modules", ".git", ".expo"]);

async function findBundles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const bundles = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      bundles.push(...(await findBundles(path.join(directory, entry.name))));
    } else if (
      bundleNames.has(entry.name) ||
      entry.name.endsWith(".jsbundle") ||
      entry.name.endsWith(".hbc")
    ) {
      bundles.push(path.join(directory, entry.name));
    }
  }
  return bundles;
}

if (expectedValues.length !== 5) {
  console.error(
    "EAS release bundle validation cannot run because a required public value is missing.",
  );
  process.exit(1);
}

const bundles = await findBundles(root);
if (bundles.length === 0) {
  console.error("EAS release bundle validation found no native JavaScript bundle.");
  process.exit(1);
}

for (const bundlePath of bundles) {
  const contents = await fs.readFile(bundlePath, "utf8");
  const missing = expectedValues.some((value) => !contents.includes(value));
  if (missing) {
    console.error(
      `EAS release bundle is missing validated release configuration: ${path.relative(
        root,
        bundlePath,
      )}`,
    );
    process.exit(1);
  }
}

console.log(
  `Validated release configuration, including the PostHog host and expected public configuration, in ${bundles.length} EAS native bundle(s).`,
);
