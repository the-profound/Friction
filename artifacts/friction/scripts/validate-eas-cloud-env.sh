#!/usr/bin/env bash
set -euo pipefail

TRACK="${1:?Usage: validate-eas-cloud-env.sh <preview|production>}"
if [[ "$TRACK" != "preview" && "$TRACK" != "production" ]]; then
  echo "Only preview and production release tracks require Cloud environment validation."
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"

# The local release environment is the intended target. Its values are read only
# to derive a non-reversible fingerprint, which is then compared inside a clean
# EAS Cloud environment. Do not print the values themselves.
EXPECTED_FINGERPRINT="$(
  APP_RELEASE_TRACK="$TRACK" EAS_BUILD_PROFILE="$TRACK" \
    node "$SCRIPT_DIR/validate-release-env.mjs" --track "$TRACK" --json |
    node -e 'let data = ""; process.stdin.on("data", (chunk) => data += chunk).on("end", () => process.stdout.write(JSON.parse(data).configurationFingerprint));'
)"

echo "🔎 EAS Cloud ${TRACK} 환경을 릴리즈 지문으로 대조 중..."
env \
  -u EXPO_PUBLIC_SUPABASE_URL \
  -u EXPO_PUBLIC_SUPABASE_ANON_KEY \
  -u EXPO_PUBLIC_DOMAIN \
  -u APP_RELEASE_TRACK \
  -u EAS_BUILD_PROFILE \
  -u RELEASE_CONFIG_EXPECTED_FINGERPRINT \
  "$EAS" env:exec "$TRACK" \
  "APP_RELEASE_TRACK=\"$TRACK\" EAS_BUILD_PROFILE=\"$TRACK\" RELEASE_CONFIG_EXPECTED_FINGERPRINT=\"$EXPECTED_FINGERPRINT\" node \"$SCRIPT_DIR/validate-release-env.mjs\" --track \"$TRACK\" --expect-fingerprint \"$EXPECTED_FINGERPRINT\"" \
  --non-interactive