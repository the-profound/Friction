#!/bin/bash
set -e

EAS="/home/runner/workspace/.config/npm/node_global/bin/eas"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Friction iOS Publish (EAS)"
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

export EXPO_APPLE_TEAM_ID="D9P94YPN8F"

echo "$APP_STORE_CONNECT_P8_KEY" > /tmp/asc_api_key.p8
chmod 600 /tmp/asc_api_key.p8
echo "✅ App Store Connect API Key 임시 파일 생성 완료"

cd "$APP_DIR"

echo ""
echo "📦 iOS 빌드 및 App Store Connect 제출 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""
$EAS build \
  --platform ios \
  --profile production \
  --non-interactive \
  --wait \
  --auto-submit

rm -f /tmp/asc_api_key.p8
echo ""
echo "✅ 제출 완료! App Store Connect에서 심사 상태를 확인하세요."
echo "   https://appstoreconnect.apple.com"
