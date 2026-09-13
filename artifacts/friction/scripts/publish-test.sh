#!/usr/bin/env bash
set -euo pipefail

EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_OUTPUT="$(mktemp /tmp/friction_test_build.XXXXXX.json)"
trap 'rm -f "$BUILD_OUTPUT"' EXIT

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

echo ""
echo "📦 [1/2] iOS 및 Android 빌드 시작 (EAS Cloud)..."
"$EAS" build \
  --platform all \
  --profile test \
  --non-interactive \
  --wait \
  --json > "$BUILD_OUTPUT"

BUILD_DETAILS_OUTPUT="$(
  python3 - "$BUILD_OUTPUT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    payload = json.load(file)

builds = payload if isinstance(payload, list) else [payload]
ios = next((build for build in builds if str(build.get("platform", "")).lower() == "ios"), None)
android = next((build for build in builds if str(build.get("platform", "")).lower() == "android"), None)

if not ios or not ios.get("id"):
    raise SystemExit("EAS multi-platform build did not return an iOS build ID.")

artifacts = (android or {}).get("artifacts") or {}
apk_url = artifacts.get("buildUrl") or artifacts.get("applicationArchiveUrl")
if not android or not android.get("id") or not apk_url:
    raise SystemExit("EAS multi-platform build did not return an Android APK artifact URL.")

print(ios["id"])
print(android["id"])
print(apk_url)
print(android.get("buildDetailsPageUrl") or "")
PY
)"
mapfile -t BUILD_DETAILS <<< "$BUILD_DETAILS_OUTPUT"
IOS_BUILD_ID="${BUILD_DETAILS[0]}"
ANDROID_BUILD_ID="${BUILD_DETAILS[1]}"
APK_URL="${BUILD_DETAILS[2]}"
ANDROID_DETAILS_URL="${BUILD_DETAILS[3]:-}"

echo ""
echo "✅ iOS 빌드 완료 (ID: $IOS_BUILD_ID)"
echo "✅ Android APK 빌드 완료 (ID: $ANDROID_BUILD_ID)"
echo "📲 APK 다운로드: $APK_URL"
if [[ -n "$ANDROID_DETAILS_URL" ]]; then
  echo "   EAS 빌드 상세: $ANDROID_DETAILS_URL"
fi
echo "   Google Play Console 제출은 수행하지 않습니다."

echo ""
echo "🚀 [2/2] iOS 빌드를 App Store Connect에 제출합니다..."
"$EAS" submit \
  --platform ios \
  --id "$IOS_BUILD_ID" \
  --profile test \
  --non-interactive

echo ""
echo "✅ iOS 제출 완료. Android APK는 위 링크에서 설치할 수 있습니다."