#!/usr/bin/env node

import { buildReleaseConfigSummary } from "./release-config.mjs";

const args = new Set(process.argv.slice(2));
const trackIndex = process.argv.indexOf("--track");
const fingerprintIndex = process.argv.indexOf("--expect-fingerprint");
const expectedTrack = trackIndex >= 0 ? process.argv[trackIndex + 1] : undefined;
const expectedFingerprint =
  fingerprintIndex >= 0 ? process.argv[fingerprintIndex + 1] : process.env.RELEASE_CONFIG_EXPECTED_FINGERPRINT;
const summary = buildReleaseConfigSummary(process.env, expectedTrack);

if (!summary.valid) {
  console.error(`Release configuration is incomplete or invalid: ${summary.issues.join(", ")}.`);
  console.error(
    "Configure the required values in the matching EAS environment and retry. Values are never printed.",
  );
  process.exit(1);
}

if (expectedFingerprint && summary.configurationFingerprint !== expectedFingerprint) {
  console.error(
    "EAS Cloud configuration does not match the expected release configuration fingerprint. Values are never printed.",
  );
  process.exit(1);
}

if (args.has("--json")) {
  console.log(JSON.stringify(summary));
} else {
  console.log(
    `Release configuration validated: track=${summary.track}, fingerprint=${summary.configurationFingerprint}.`,
  );
}