#!/usr/bin/env bash
set -euo pipefail

EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
IOS_BUILD_OUTPUT="$(mktemp /tmp/friction_test_ios_build.XXXXXX.json)"
ANDROID_BUILD_OUTPUT="$(mktemp /tmp/friction_test_android_build.XXXXXX.json)"
trap 'rm -f "$IOS_BUILD_OUTPUT" "$ANDROID_BUILD_OUTPUT"' EXIT

echo "========================================"
echo "  Friction iOS & Android Test Publish"
echo "========================================"

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "❌ EXPO_TOKEN 환경변수가 없습니다."
  exit 1
fi

echo ""
echo "🔎 릴리즈 환경 변수 검증 중..."
APP_RELEASE_TRACK=production EAS_BUILD_PROFILE=test \
  node "$SCRIPT_DIR/validate-release-env.mjs" --track production
bash "$SCRIPT_DIR/validate-eas-cloud-env.sh" test

export EXPO_APPLE_TEAM_ID="D9P94YPN8F"
cd "$APP_DIR"

run_ios_publish() {
  echo ""
  echo "🍎 [iOS 빌드] EAS Cloud 빌드를 시작합니다..."
  if ! "$EAS" build --platform ios --profile test --non-interactive --wait --json \
    > "$IOS_BUILD_OUTPUT" \
    2> >(sed 's/^/[iOS 빌드:EAS] /' >&2); then
    echo "❌ [iOS 빌드] 빌드에 실패했습니다." >&2
    return 1
  fi

  local ios_build_id
  if ! ios_build_id="$(
    python3 - "$IOS_BUILD_OUTPUT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    payload = json.load(file)
builds = payload if isinstance(payload, list) else [payload]
ios = next((build for build in builds if str(build.get("platform", "")).lower() == "ios"), None)
if not ios or not ios.get("id"):
    raise SystemExit("EAS iOS build did not return an iOS build ID.")
print(ios["id"])
PY
  )"; then
    echo "❌ [iOS 빌드] 성공 결과에서 빌드 ID를 확인하지 못했습니다." >&2
    return 1
  fi

  echo "✅ [iOS 빌드] 완료 (ID: $ios_build_id)"
  echo "🚀 [iOS 제출] App Store Connect 제출을 시작합니다..."
  if ! "$EAS" submit --platform ios --id "$ios_build_id" --profile test --non-interactive \
    > >(sed 's/^/[iOS 제출:EAS] /') \
    2> >(sed 's/^/[iOS 제출:EAS] /' >&2); then
    echo "❌ [iOS 제출] App Store Connect 제출에 실패했습니다. (빌드 ID: $ios_build_id)" >&2
    return 1
  fi
  echo "✅ [iOS 제출] 완료 (빌드 ID: $ios_build_id)"
}

run_android_build() {
  echo ""
  echo "🤖 [Android 빌드] EAS Cloud APK 빌드를 시작합니다..."
  if ! "$EAS" build --platform android --profile test --non-interactive --wait --json \
    > "$ANDROID_BUILD_OUTPUT" \
    2> >(sed 's/^/[Android 빌드:EAS] /' >&2); then
    echo "❌ [Android 빌드] 빌드에 실패했습니다." >&2
    return 1
  fi

  local build_details_output
  if ! build_details_output="$(
    python3 - "$ANDROID_BUILD_OUTPUT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    payload = json.load(file)
builds = payload if isinstance(payload, list) else [payload]
android = next((build for build in builds if str(build.get("platform", "")).lower() == "android"), None)
artifacts = (android or {}).get("artifacts") or {}
apk_url = artifacts.get("buildUrl") or artifacts.get("applicationArchiveUrl")
if not android or not android.get("id"):
    raise SystemExit("EAS Android build did not return an Android build ID.")
if not apk_url:
    raise SystemExit("EAS Android build did not return an APK artifact URL.")
print(android["id"])
print(apk_url)
print(android.get("buildDetailsPageUrl") or "")
PY
  )"; then
    echo "❌ [Android 결과] APK 아티팩트 정보를 확인하지 못했습니다." >&2
    return 1
  fi

  local build_details=()
  mapfile -t build_details <<< "$build_details_output"
  echo "✅ [Android 빌드] APK 완료 (ID: ${build_details[0]})"
  echo "📲 [Android 결과] APK 다운로드: ${build_details[1]}"
  if [[ -n "${build_details[2]:-}" ]]; then
    echo "   [Android 결과] EAS 빌드 상세: ${build_details[2]}"
  fi
  echo "ℹ️ [Android 제출] Google Play Console 제출은 수행하지 않습니다."
}

echo ""
echo "📦 iOS 빌드·제출과 Android APK 빌드를 병렬로 시작합니다..."
run_ios_publish &
IOS_PID=$!
run_android_build &
ANDROID_PID=$!

IOS_STATUS=0
ANDROID_STATUS=0
wait "$IOS_PID" || IOS_STATUS=$?
wait "$ANDROID_PID" || ANDROID_STATUS=$?

echo ""
if [[ "$IOS_STATUS" -eq 0 ]]; then
  echo "✅ [iOS 경로] 빌드 및 제출 성공"
else
  echo "❌ [iOS 경로] 실패 (종료 코드: $IOS_STATUS)" >&2
fi
if [[ "$ANDROID_STATUS" -eq 0 ]]; then
  echo "✅ [Android 경로] APK 빌드 및 결과 확인 성공"
else
  echo "❌ [Android 경로] 실패 (종료 코드: $ANDROID_STATUS)" >&2
fi

if [[ "$IOS_STATUS" -ne 0 || "$ANDROID_STATUS" -ne 0 ]]; then
  exit 1
fi

echo "✅ Test Publish가 완료되었습니다."