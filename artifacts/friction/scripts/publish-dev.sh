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
if [ -z "$APP_STORE_CONNECT_KEY_ID" ]; then
  echo "❌ APP_STORE_CONNECT_KEY_ID 환경변수가 없습니다."
  exit 1
fi
if [ -z "$APP_STORE_CONNECT_ISSUER_ID" ]; then
  echo "❌ APP_STORE_CONNECT_ISSUER_ID 환경변수가 없습니다."
  exit 1
fi
if [ -z "$APP_STORE_CONNECT_P8_KEY" ]; then
  echo "❌ APP_STORE_CONNECT_P8_KEY 환경변수가 없습니다."
  exit 1
fi

export EXPO_APPLE_TEAM_ID="D9P94YPN8F"

echo "$APP_STORE_CONNECT_P8_KEY" > /tmp/asc_api_key.p8
chmod 600 /tmp/asc_api_key.p8
echo "✅ App Store Connect API Key 임시 파일 생성 완료"

cd "$APP_DIR"

echo ""
echo "📦 [1/2] iOS dev-client 빌드 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""
$EAS build \
  --platform ios \
  --profile development \
  --non-interactive \
  --wait

echo ""
echo "🚀 [2/2] TestFlight (internal testers) 제출 시작..."
echo ""
$EAS submit \
  --platform ios \
  --latest \
  --profile development \
  --non-interactive

rm -f /tmp/asc_api_key.p8
echo ""
echo "✅ 제출 완료!"
echo "   TestFlight 앱에서 'Friction (dev)' 빌드를 확인하세요."
echo "   설치 후 pnpm dev:tunnel 을 실행하고 고정 주소를 앱에 입력하면 됩니다."
