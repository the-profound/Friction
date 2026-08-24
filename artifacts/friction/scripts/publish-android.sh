#!/usr/bin/env bash
set -euo pipefail

EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
BUILD_OUTPUT="$(mktemp /tmp/friction_android_build.XXXXXX.json)"
trap 'rm -f "$BUILD_OUTPUT"' EXIT

echo "========================================"
echo "  Friction Android Test APK (EAS)"
echo "========================================"
echo ""
echo "  This creates a directly installable test APK with the release app identity."
echo "  It does not submit anything to Google Play Console."
echo ""

if [[ -z "${EXPO_TOKEN:-}" ]]; then
  echo "❌ EXPO_TOKEN 환경변수가 없습니다."
  exit 1
fi

echo ""
echo "🔎 릴리즈 환경 변수 검증 중..."
APP_RELEASE_TRACK=production EAS_BUILD_PROFILE=production \
  node "$SCRIPT_DIR/validate-release-env.mjs" --track production
bash "$SCRIPT_DIR/validate-eas-cloud-env.sh" production

cd "$APP_DIR"

echo ""
echo "📦 Android test APK 빌드 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""

"$EAS" build \
  --platform android \
  --profile android-test \
  --non-interactive \
  --wait \
  --json > "$BUILD_OUTPUT"

BUILD_DETAILS_OUTPUT="$(
  python3 - "$BUILD_OUTPUT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    payload = json.load(file)

build = payload[0] if isinstance(payload, list) else payload
artifacts = build.get("artifacts") or {}
build_id = build.get("id")
apk_url = artifacts.get("buildUrl") or artifacts.get("applicationArchiveUrl")
details_url = build.get("buildDetailsPageUrl") or ""

if not build_id or not apk_url:
    raise SystemExit(
        "EAS build completed but did not return an Android APK artifact URL. "
        "Open the EAS build dashboard to find the build artifact."
    )

print(build_id)
print(apk_url)
print(details_url)
PY
)"
mapfile -t BUILD_DETAILS <<< "$BUILD_DETAILS_OUTPUT"

BUILD_ID="${BUILD_DETAILS[0]}"
APK_URL="${BUILD_DETAILS[1]}"
BUILD_DETAILS_URL="${BUILD_DETAILS[2]:-}"

echo ""
echo "✅ Android test APK 빌드 완료 (ID: $BUILD_ID)"
echo ""
echo "📲 APK 다운로드 및 설치:"
echo "   $APK_URL"
if [[ -n "$BUILD_DETAILS_URL" ]]; then
  echo ""
  echo "   EAS 빌드 상세: $BUILD_DETAILS_URL"
fi
echo ""
echo "Google Play Console 제출은 수행하지 않았습니다."