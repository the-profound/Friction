#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
EAS_MARKER="$TMP_DIR/eas-invoked"
FAKE_EAS="$TMP_DIR/eas"

cat > "$FAKE_EAS" <<'EOF'
#!/bin/bash
touch "$EAS_MARKER"
echo "EAS must not run when local release configuration is incomplete." >&2
exit 99
EOF
chmod +x "$FAKE_EAS"

run_missing_value_case() {
  local script_name="$1"
  local missing_name="$2"
  local output="$TMP_DIR/${script_name}-${missing_name}.log"

  rm -f "$EAS_MARKER"
  set +e
  EAS_MARKER="$EAS_MARKER" \
    EAS_BIN="$FAKE_EAS" \
    EXPO_TOKEN="test-token" \
    APP_STORE_CONNECT_KEY_ID="test-key-id" \
    APP_STORE_CONNECT_ISSUER_ID="test-issuer-id" \
    APP_STORE_CONNECT_P8_KEY="test-p8-key" \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    env -u "$missing_name" \
    bash "$SCRIPT_DIR/$script_name" > "$output" 2>&1
  local status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "Expected $script_name to reject missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
  if [ -e "$EAS_MARKER" ]; then
    echo "$script_name invoked EAS despite missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
  if ! grep -q "$missing_name" "$output"; then
    echo "$script_name did not identify missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
}

for script_name in publish-test.sh publish-ios.sh publish-preview.sh publish-android.sh; do
  for variable in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_DOMAIN EXPO_PUBLIC_POSTHOG_TOKEN EXPO_PUBLIC_POSTHOG_HOST; do
    run_missing_value_case "$script_name" "$variable"
  done
done

INVALID_POSTHOG_OUTPUT="$TMP_DIR/invalid-posthog.log"
if EAS_BUILD_PROFILE=test \
  APP_RELEASE_TRACK=production \
  EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
  EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
  EXPO_PUBLIC_DOMAIN="release-test.example" \
  EXPO_PUBLIC_POSTHOG_TOKEN="phc_must_not_appear_in_output" \
  EXPO_PUBLIC_POSTHOG_HOST="http://insecure.posthog.example" \
  node "$SCRIPT_DIR/validate-release-env.mjs" > "$INVALID_POSTHOG_OUTPUT" 2>&1; then
  echo "Expected insecure PostHog host to be rejected." >&2
  exit 1
fi
grep -q "EXPO_PUBLIC_POSTHOG_HOST" "$INVALID_POSTHOG_OUTPUT"
if grep -q "phc_must_not_appear_in_output" "$INVALID_POSTHOG_OUTPUT"; then
  echo "Release validation exposed the PostHog token." >&2
  exit 1
fi

node - "$SCRIPT_DIR/../eas.json" <<'NODE'
const fs = require("node:fs");
const eas = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const test = eas.build?.test;
if (
  test?.environment !== "production" ||
  test?.env?.APP_RELEASE_TRACK !== "production" ||
  test?.ios?.distribution !== "store" ||
  test?.android?.buildType !== "apk" ||
  eas.submit?.test?.ios?.ascAppId !== "6795505833"
) {
  throw new Error("The shared test build/submit profile is incomplete.");
}
if (eas.build?.production || eas.build?.["android-test"] || eas.submit?.production) {
  throw new Error("Obsolete production/android-test profiles are still configured.");
}
if (
  eas.build?.preview?.env?.APP_RELEASE_TRACK !== "preview" ||
  eas.build?.preview?.environment !== "preview" ||
  eas.build?.development?.env?.APP_RELEASE_TRACK !== "development" ||
  eas.build?.development?.environment !== "development" ||
  eas.build?.development?.developmentClient !== true
) {
  throw new Error("Preview or development profile behavior changed.");
}
NODE

if rg -n --glob '*.sh' --glob '*.mjs' -- \
  '--profile (production|android-test)|EAS_BUILD_PROFILE=(production|android-test)' \
  "$SCRIPT_DIR" > "$TMP_DIR/obsolete-profile-references.log"; then
  echo "Obsolete test publish profile reference found:" >&2
  cat "$TMP_DIR/obsolete-profile-references.log" >&2
  exit 1
fi

INVOCATION_LOG="$TMP_DIR/eas-invocations.log"
SUCCESS_EAS="$TMP_DIR/eas-success"
cat > "$SUCCESS_EAS" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$INVOCATION_LOG"

if [[ "$1" == "env:exec" ]]; then
  export EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co"
  export EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key"
  export EXPO_PUBLIC_DOMAIN="release-test.example"
  export EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token"
  export EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com"
  eval "$3"
elif [[ "$1" == "build" ]]; then
  platform=""
  while [[ "$#" -gt 0 ]]; do
    if [[ "$1" == "--platform" ]]; then
      platform="$2"
      break
    fi
    shift
  done
  touch "$SYNC_DIR/$platform.started"
  other="android"
  [[ "$platform" == "android" ]] && other="ios"
  for _ in $(seq 1 100); do
    [[ -e "$SYNC_DIR/$other.started" ]] && break
    sleep 0.02
  done
  if [[ ! -e "$SYNC_DIR/$other.started" ]]; then
    echo "$platform build was not started in parallel." >&2
    exit 3
  fi
  if [[ "$platform" == "ios" ]]; then
    echo '{"id":"ios-build-id","platform":"IOS"}'
  elif [[ "${ANDROID_RESULT:-success}" == "missing-artifact" ]]; then
    echo '{"id":"android-build-id","platform":"ANDROID","artifacts":{}}'
  else
    echo '{"id":"android-build-id","platform":"ANDROID","artifacts":{"buildUrl":"https://example.test/friction.apk"},"buildDetailsPageUrl":"https://example.test/android-build"}'
  fi
elif [[ "$1" == "submit" ]]; then
  [[ "${IOS_SUBMIT_RESULT:-success}" != "failure" ]] || exit 4
else
  echo "Unexpected EAS command: $*" >&2
  exit 2
fi
EOF
chmod +x "$SUCCESS_EAS"

run_publish_case() {
  local case_name="$1"
  local expected_status="$2"
  local android_result="$3"
  local ios_submit_result="$4"
  local output="$TMP_DIR/publish-test-$case_name.log"
  local sync_dir="$TMP_DIR/sync-$case_name"
  mkdir -p "$sync_dir"
  : > "$INVOCATION_LOG"

  set +e
  INVOCATION_LOG="$INVOCATION_LOG" \
    SYNC_DIR="$sync_dir" \
    ANDROID_RESULT="$android_result" \
    IOS_SUBMIT_RESULT="$ios_submit_result" \
    EAS_BIN="$SUCCESS_EAS" \
    EXPO_TOKEN="test-token" \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    bash "$SCRIPT_DIR/publish-test.sh" > "$output" 2>&1
  local status=$?
  set -e

  if [[ "$expected_status" == "success" && "$status" -ne 0 ]] ||
     [[ "$expected_status" == "failure" && "$status" -eq 0 ]]; then
    echo "Unexpected status for publish case $case_name: $status" >&2
    cat "$output" >&2
    exit 1
  fi
  if [[ "$(grep -c '^build ' "$INVOCATION_LOG")" -ne 2 ]]; then
    echo "Test publish must invoke one independent build per platform." >&2
    cat "$INVOCATION_LOG" >&2
    exit 1
  fi
  grep -q '^build --platform ios --profile test ' "$INVOCATION_LOG"
  grep -q '^build --platform android --profile test ' "$INVOCATION_LOG"
  grep -q '^env:exec production ' "$INVOCATION_LOG"
  if [[ "$(grep -c '^submit ' "$INVOCATION_LOG" || true)" -ne 1 ]] ||
     [[ "$(grep -c '^submit --platform ios --id ios-build-id --profile test ' "$INVOCATION_LOG" || true)" -ne 1 ]]; then
    echo "Test publish must invoke exactly one submission, for the completed iOS build." >&2
    cat "$INVOCATION_LOG" >&2
    exit 1
  fi
}

run_publish_case success success success success
grep -q '^submit --platform ios --id ios-build-id --profile test ' "$INVOCATION_LOG"
grep -q 'https://example.test/friction.apk' "$TMP_DIR/publish-test-success.log"
grep -q '\[iOS 제출\] 완료' "$TMP_DIR/publish-test-success.log"

run_publish_case android-missing-artifact failure missing-artifact success
grep -q '^submit --platform ios --id ios-build-id --profile test ' "$INVOCATION_LOG"
grep -q '\[iOS 제출\] 완료' "$TMP_DIR/publish-test-android-missing-artifact.log"
grep -q '\[Android 결과\] APK 아티팩트 정보를 확인하지 못했습니다' "$TMP_DIR/publish-test-android-missing-artifact.log"

run_publish_case ios-submit-failure failure success failure
grep -q '^submit --platform ios --id ios-build-id --profile test ' "$INVOCATION_LOG"
grep -q 'https://example.test/friction.apk' "$TMP_DIR/publish-test-ios-submit-failure.log"
grep -q '\[iOS 제출\] App Store Connect 제출에 실패했습니다' "$TMP_DIR/publish-test-ios-submit-failure.log"
grep -q '\[Android 경로\] APK 빌드 및 결과 확인 성공' "$TMP_DIR/publish-test-ios-submit-failure.log"

(
  cd "$SCRIPT_DIR/.."
  EAS_BUILD_PROFILE=test \
    APP_RELEASE_TRACK=production \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    node scripts/validate-resolved-release-config.mjs
) > "$TMP_DIR/resolved-test-config.log"
grep -q 'track=production' "$TMP_DIR/resolved-test-config.log"

(
  cd "$SCRIPT_DIR/.."
  EAS_BUILD_PROFILE=development \
    APP_RELEASE_TRACK=development \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    node scripts/validate-resolved-release-config.mjs
) > "$TMP_DIR/resolved-development-config.log"
grep -q 'track=development' "$TMP_DIR/resolved-development-config.log"

BUNDLE_DIR="$TMP_DIR/bundle-check"
mkdir -p "$BUNDLE_DIR"
cat > "$BUNDLE_DIR/main.jsbundle" <<'EOF'
https://release-test.supabase.co release-test-anon-key release-test.example
https://us.i.posthog.com phc_release_test_token
EOF
(
  cd "$BUNDLE_DIR"
  EAS_BUILD_PROFILE=test \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    node "$SCRIPT_DIR/validate-eas-bundle.mjs"
) > "$TMP_DIR/bundle-success.log"
grep -q "Validated release configuration" "$TMP_DIR/bundle-success.log"

sed -i 's/phc_release_test_token/token-was-not-compiled/' "$BUNDLE_DIR/main.jsbundle"
if (
  cd "$BUNDLE_DIR"
  EAS_BUILD_PROFILE=test \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    EXPO_PUBLIC_POSTHOG_TOKEN="phc_release_test_token" \
    EXPO_PUBLIC_POSTHOG_HOST="https://us.i.posthog.com" \
    node "$SCRIPT_DIR/validate-eas-bundle.mjs"
) > "$TMP_DIR/bundle-failure.log" 2>&1; then
  echo "Expected bundle validation to reject a missing PostHog token." >&2
  exit 1
fi
if grep -q "phc_release_test_token" "$TMP_DIR/bundle-failure.log"; then
  echo "Bundle validation exposed the PostHog token." >&2
  exit 1
fi

echo "Release publication guards validated parallel platform builds, isolated iOS submission, Android APK-only reporting, failure isolation, and missing-value rejection."