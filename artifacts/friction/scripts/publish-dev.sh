#!/bin/bash
set -e

EAS="/home/runner/workspace/.config/npm/node_global/bin/eas"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Friction iOS Dev-Client Build (EAS)"
echo "========================================"
echo ""
echo "  This produces an expo-dev-client binary distributed via"
echo "  TestFlight (internal testers).  Once installed, the app"
echo "  shows the dev-client UI and can connect to a live Metro"
echo "  server via the fixed ngrok tunnel."
echo ""

if [ -z "$EXPO_TOKEN" ]; then
  echo "❌ EXPO_TOKEN 환경변수가 없습니다."
  exit 1
fi

export EXPO_APPLE_TEAM_ID="D9P94YPN8F"
export APP_VARIANT="development"

cd "$APP_DIR"

echo ""
echo "📦 [1/2] iOS dev-client 빌드 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""

$EAS build \
  --platform ios \
  --profile development \
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
echo "🚀 [2/2] TestFlight (internal testers) 제출 시작..."
echo ""

$EAS submit \
  --platform ios \
  --id "$BUILD_ID" \
  --profile development \
  --non-interactive

echo ""
echo "✅ 제출 완료!"
echo "   TestFlight 앱에서 'Friction (dev)' 빌드를 확인하세요."
echo "   설치 후 pnpm dev:tunnel 을 실행하고 고정 주소를 앱에 입력하면 됩니다."
