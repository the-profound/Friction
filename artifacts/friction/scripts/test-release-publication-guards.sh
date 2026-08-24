#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
EAS_MARKER="$TMP_DIR/eas-invoked"
FAKE_EAS="$TMP_DIR/eas"

cat > "$FAKE_EAS" <<'EOF'
#!/bin/bash
touch "$EAS_MARKER"
echo "EAS must not run when local release configuration is incomplete." >&2
exit 99
EOF
chmod +x "$FAKE_EAS"

run_missing_value_case() {
  local script_name="$1"
  local missing_name="$2"
  local output="$TMP_DIR/${script_name}-${missing_name}.log"

  rm -f "$EAS_MARKER"
  set +e
  EAS_MARKER="$EAS_MARKER" \
    EAS_BIN="$FAKE_EAS" \
    EXPO_TOKEN="test-token" \
    APP_STORE_CONNECT_KEY_ID="test-key-id" \
    APP_STORE_CONNECT_ISSUER_ID="test-issuer-id" \
    APP_STORE_CONNECT_P8_KEY="test-p8-key" \
    EXPO_PUBLIC_SUPABASE_URL="https://release-test.supabase.co" \
    EXPO_PUBLIC_SUPABASE_ANON_KEY="release-test-anon-key" \
    EXPO_PUBLIC_DOMAIN="release-test.example" \
    env -u "$missing_name" \
    bash "$SCRIPT_DIR/$script_name" > "$output" 2>&1
  local status=$?
  set -e

  if [ "$status" -eq 0 ]; then
    echo "Expected $script_name to reject missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
  if [ -e "$EAS_MARKER" ]; then
    echo "$script_name invoked EAS despite missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
  if ! grep -q "$missing_name" "$output"; then
    echo "$script_name did not identify missing $missing_name." >&2
    cat "$output" >&2
    exit 1
  fi
}

for script_name in publish-ios.sh publish-preview.sh publish-android.sh; do
  for variable in EXPO_PUBLIC_SUPABASE_URL EXPO_PUBLIC_SUPABASE_ANON_KEY EXPO_PUBLIC_DOMAIN; do
    run_missing_value_case "$script_name" "$variable"
  done
done

echo "Release publish guards reject every missing local public configuration value before EAS runs."