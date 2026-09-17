#!/usr/bin/env bash
set -euo pipefail

PROFILE="${1:?Usage: validate-eas-cloud-env.sh <development|preview|test>}"
if [[ "$PROFILE" != "development" && "$PROFILE" != "preview" && "$PROFILE" != "test" ]]; then
  echo "Only configured EAS build profiles can be validated."
  exit 1
fi
CLOUD_ENV="$PROFILE"
RELEASE_TRACK="$PROFILE"
if [[ "$PROFILE" == "test" ]]; then
  CLOUD_ENV="production"
  RELEASE_TRACK="production"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"

# The local release environment is the intended target. Its values are read only
# to derive a non-reversible fingerprint, which is then compared inside a clean
# EAS Cloud environment. Do not print the values themselves.
EXPECTED_FINGERPRINT="$(
  APP_RELEASE_TRACK="$RELEASE_TRACK" EAS_BUILD_PROFILE="$PROFILE" \
    node "$SCRIPT_DIR/validate-release-env.mjs" --track "$RELEASE_TRACK" --json |
    node -e 'let data = ""; process.stdin.on("data", (chunk) => data += chunk).on("end", () => process.stdout.write(JSON.parse(data).configurationFingerprint));'
)"

echo "🔎 EAS Cloud ${CLOUD_ENV} 환경을 ${PROFILE} 프로필의 ${RELEASE_TRACK} 릴리즈 지문으로 대조 중..."
(
  cd "$APP_DIR"
  env \
    -u EXPO_PUBLIC_SUPABASE_URL \
    -u EXPO_PUBLIC_SUPABASE_ANON_KEY \
    -u EXPO_PUBLIC_DOMAIN \
    -u EXPO_PUBLIC_POSTHOG_TOKEN \
    -u EXPO_PUBLIC_POSTHOG_HOST \
    -u APP_RELEASE_TRACK \
    -u EAS_BUILD_PROFILE \
    -u RELEASE_CONFIG_EXPECTED_FINGERPRINT \
    "$EAS" env:exec "$CLOUD_ENV" \
    "APP_RELEASE_TRACK=\"$RELEASE_TRACK\" EAS_BUILD_PROFILE=\"$PROFILE\" RELEASE_CONFIG_EXPECTED_FINGERPRINT=\"$EXPECTED_FINGERPRINT\" node \"$SCRIPT_DIR/validate-release-env.mjs\" --track \"$RELEASE_TRACK\" --expect-fingerprint \"$EXPECTED_FINGERPRINT\"" \
    --non-interactive
)