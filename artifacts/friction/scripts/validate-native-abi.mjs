#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const expectedVersion = "57.0.12";
const packagePath = resolve("package.json");
const lockfilePath = resolve("../../pnpm-lock.yaml");
const workspacePath = resolve("../../pnpm-workspace.yaml");

const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const lockfile = await readFile(lockfilePath, "utf8");
const workspaceConfig = await readFile(workspacePath, "utf8");
const dependencies = {
  "expo-image-manipulator": packageJson.devDependencies?.["expo-image-manipulator"],
  "expo-modules-core": packageJson.dependencies?.["expo-modules-core"],
};

const issues = [];
for (const [name, specifier] of Object.entries(dependencies)) {
  if (specifier !== expectedVersion) {
    issues.push(`${name} must be pinned to ${expectedVersion}`);
  }
  const importerEntry = new RegExp(
    `\\n\\s{6}${name}:\\n\\s{8}specifier: ${expectedVersion}\\n\\s{8}version: ${expectedVersion.replaceAll(".", "\\.")}`,
  );
  if (!importerEntry.test(lockfile)) {
    issues.push(`${name} is not resolved to ${expectedVersion} in pnpm-lock.yaml`);
  }
  if (!new RegExp(`^\\s{2}${name}: ${expectedVersion.replaceAll(".", "\\.")}$`, "m").test(workspaceConfig)) {
    issues.push(`${name} is missing the workspace override at ${expectedVersion}`);
  }
}

if (issues.length > 0) {
  console.error(`Native Expo ABI pairing validation failed: ${issues.join("; ")}.`);
  process.exit(1);
}

console.log(
  `Native Expo ABI pairing validated: expo-image-manipulator=${expectedVersion}, expo-modules-core=${expectedVersion}.`,
);