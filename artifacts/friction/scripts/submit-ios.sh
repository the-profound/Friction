#!/bin/bash
set -e

EAS="/home/runner/workspace/.config/npm/node_global/bin/eas"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Friction iOS Submit (App Store)"
echo "========================================"

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

echo "$APP_STORE_CONNECT_P8_KEY" > /tmp/asc_api_key.p8
chmod 600 /tmp/asc_api_key.p8
echo "✅ App Store Connect API Key 임시 파일 생성 완료"

cd "$APP_DIR"

echo ""
echo "🚀 App Store Connect 제출 시작..."
echo "    (가장 최근 EAS 빌드를 제출합니다)"
echo ""
$EAS submit \
  --platform ios \
  --latest \
  --profile test \
  --non-interactive

rm -f /tmp/asc_api_key.p8
echo ""
echo "✅ 제출 완료! App Store Connect에서 심사 상태를 확인하세요."
echo "   https://appstoreconnect.apple.com"
