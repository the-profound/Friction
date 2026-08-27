#!/bin/bash
set -e

EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Friction iOS Publish (EAS)"
echo "========================================"

if [ -z "$EXPO_TOKEN" ]; then
  echo "❌ EXPO_TOKEN 환경변수가 없습니다."
  exit 1
fi

echo ""
echo "🔎 릴리즈 환경 변수 검증 중..."
APP_RELEASE_TRACK=production EAS_BUILD_PROFILE=production \
  node "$SCRIPT_DIR/validate-release-env.mjs" --track production
bash "$SCRIPT_DIR/validate-eas-cloud-env.sh" production
node "$SCRIPT_DIR/validate-native-abi.mjs"

export EXPO_APPLE_TEAM_ID="D9P94YPN8F"

cd "$APP_DIR"

echo ""
echo "📦 [1/2] iOS 빌드 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""

$EAS build \
  --platform ios \
  --profile production \
  --non-interactive \
  --wait \
  --json > /tmp/eas_build_output.json

BUILD_ID=$(python3 -c "
import json, sys
d = json.load(open('/tmp/eas_build_output.json'))
print(d[0]['id'] if isinstance(d, list) else d['id'])
" 2>/dev/null)

echo ""
echo "✅ 빌드 완료 (ID: $BUILD_ID)"
echo ""
echo "🚀 [2/2] App Store Connect 제출 시작..."
echo ""

$EAS submit \
  --platform ios \
  --id "$BUILD_ID" \
  --profile production \
  --non-interactive

echo ""
echo "✅ 제출 완료! App Store Connect에서 심사 상태를 확인하세요."
echo "   https://appstoreconnect.apple.com"
