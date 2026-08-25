#!/bin/bash
set -e

EAS="${EAS_BIN:-/home/runner/workspace/.config/npm/node_global/bin/eas}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Friction iOS Preview Build (EAS)"
echo "========================================"
echo ""
echo "  This produces a production-like binary (JS bundle fully embedded,"
echo "  no dev tooling) distributed via TestFlight for broader beta testers."
echo "  Testers experience the app as a finished product — no Metro needed."
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

echo ""
echo "🔎 릴리즈 환경 변수 검증 중..."
APP_RELEASE_TRACK=preview EAS_BUILD_PROFILE=preview \
  node "$SCRIPT_DIR/validate-release-env.mjs" --track preview
bash "$SCRIPT_DIR/validate-eas-cloud-env.sh" preview
node "$SCRIPT_DIR/validate-native-abi.mjs"

ASC_KEY_FILE="$(mktemp /tmp/asc_api_key.XXXXXX.p8)"
trap 'rm -f "$ASC_KEY_FILE"' EXIT
printf '%s' "$APP_STORE_CONNECT_P8_KEY" > "$ASC_KEY_FILE"
chmod 600 "$ASC_KEY_FILE"
echo "✅ App Store Connect API Key 임시 파일 생성 완료"

cd "$APP_DIR"

echo ""
echo "📦 [1/2] iOS preview 빌드 시작 (EAS Cloud)..."
echo "    빌드는 보통 15~30분 소요됩니다."
echo ""
$EAS build \
  --platform ios \
  --profile preview \
  --non-interactive \
  --wait

echo ""
echo "🚀 [2/2] TestFlight (beta testers) 제출 시작..."
echo ""
$EAS submit \
  --platform ios \
  --latest \
  --profile preview \
  --non-interactive

echo ""
echo "✅ 제출 완료!"
echo "   TestFlight 앱에서 'Friction Preview'와 새 빌드 번호를 확인하세요."
echo "   App Store Connect에서 외부 테스터 그룹을 설정하면 더 넓게 배포됩니다."
