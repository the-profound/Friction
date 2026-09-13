#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { buildReleaseConfigSummary, resolveReleaseTrack } from "./release-config.mjs";

const profile = process.env.EAS_BUILD_PROFILE;
if (profile !== "preview" && profile !== "test") {
  console.log("Skipping resolved Expo config validation for non-release profile.");
  process.exit(0);
}

const expectedTrack = profile === "test" ? "production" : profile;
const summary = buildReleaseConfigSummary(process.env, expectedTrack);
if (!summary.valid) {
  console.error(`Resolved release configuration is invalid: ${summary.issues.join(", ")}.`);
  process.exit(1);
}

const rawConfig = execFileSync("pnpm", ["exec", "expo", "config", "--json"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});
const config = JSON.parse(rawConfig);
const diagnostics = config.extra?.releaseDiagnostics;
const expectedName = profile === "preview" ? "Friction Preview" : "Friction";

if (
  config.name !== expectedName ||
  config.ios?.bundleIdentifier !== "friction.by.theprofound" ||
  config.android?.package !== "friction.by.theprofound" ||
  diagnostics?.track !== resolveReleaseTrack(process.env) ||
  diagnostics?.configurationFingerprint !== summary.configurationFingerprint ||
  diagnostics?.apiHost !== summary.apiHost ||
  diagnostics?.supabaseHost !== summary.supabaseHost
) {
  console.error(
    "Resolved Expo config does not match the expected release track or sanitized configuration fingerprint.",
  );
  process.exit(1);
}

console.log(
  `Resolved Expo config validated: track=${summary.track}, fingerprint=${summary.configurationFingerprint}.`,
);