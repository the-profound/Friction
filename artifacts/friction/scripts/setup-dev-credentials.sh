#!/bin/bash
# 최초 1회만 실행합니다. dev 프로젝트의 EAS 자격증명을 대화형으로 초기화합니다.
# 완료 후 이 스크립트는 삭제해도 됩니다.
set -e

EAS="/home/runner/workspace/.config/npm/node_global/bin/eas"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================"
echo "  Dev 자격증명 초기화 (최초 1회용)"
echo "========================================"
echo ""
echo "  Apple Team ID를 물어보면 D9P94YPN8F 를 입력하세요."
echo ""

echo "$APP_STORE_CONNECT_P8_KEY" > /tmp/asc_api_key.p8
chmod 600 /tmp/asc_api_key.p8

cd "$APP_DIR"

$EAS build \
  --platform ios \
  --profile development \
  --wait

rm -f /tmp/asc_api_key.p8
echo ""
echo "✅ 자격증명 등록 완료! 이제부터는 Publish iOS(dev) 워크플로우를 사용하세요."
