#!/usr/bin/env bash
set -euo pipefail

# Installs the HAP, launches Tesslo, and collects the WebGL probe plus a screenshot.
# Usage: scripts/verify-hap.sh [hdc-target] [hap-path]

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLT="${DEVECO_CLI_CLT_PATH:-/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1}"
export PATH="$CLT/bin:$CLT/sdk/default/openharmony/toolchains:$PATH"

TARGET="${1:-}"
HAP="${2:-$ROOT/ohos/hap-template/electron/build/default/outputs/default/electron-default-signed.hap}"
OUT="$ROOT/build/verify"
BUNDLE="org.tesslo.app"
LOG="/data/app/el2/100/base/$BUNDLE/files/tesslo-main.log"

hdc_cmd() {
    if [ -n "$TARGET" ]; then
        hdc -t "$TARGET" "$@"
    else
        hdc "$@"
    fi
}

if [ ! -f "$HAP" ]; then
    echo "error: HAP not found: $HAP" >&2
    exit 1
fi

mkdir -p "$OUT"

echo "==> installing $HAP"
hdc_cmd shell aa force-stop "$BUNDLE" >/dev/null 2>&1 || true
if ! hdc_cmd install -r "$HAP" >/dev/null 2>&1; then
    hdc_cmd uninstall "$BUNDLE" >/dev/null 2>&1 || true
    hdc_cmd install "$HAP" >/dev/null
fi

echo "==> launching $BUNDLE"
hdc_cmd shell aa start -a EntryAbility -b "$BUNDLE" >/dev/null

echo "==> waiting for startup (accept clipboard/Bluetooth prompts on the device)"
sleep 15
if [ -f "$ROOT/scripts/lib/accept-permissions.sh" ]; then
    # Optional hook for devices/emulators whose permission prompts can be automated.
    bash "$ROOT/scripts/lib/accept-permissions.sh" "$TARGET" || true
fi

for _ in $(seq 1 12); do
    hdc_cmd file recv "$LOG" "$OUT/tesslo-main.log" >/dev/null 2>&1 || true
    if grep -q "webgl probe" "$OUT/tesslo-main.log" 2>/dev/null; then
        break
    fi
    sleep 5
done

echo "==> collecting main log"
hdc_cmd file recv "$LOG" "$OUT/tesslo-main.log" >/dev/null 2>&1 || true
if [ -f "$OUT/tesslo-main.log" ]; then
    grep -E "boot |scratch link|webgl probe" "$OUT/tesslo-main.log" || true
else
    echo "warning: main log not found at $LOG" >&2
fi

echo "==> screenshot"
hdc_cmd shell snapshot_display -f /data/local/tmp/tesslo-verify.jpeg >/dev/null
hdc_cmd file recv /data/local/tmp/tesslo-verify.jpeg "$OUT/tesslo-verify.jpeg" >/dev/null

echo "==> evidence written to $OUT"
echo "WebGL is the pass/fail signal: look for \"webgl probe {\\\"webgl\\\":true\"."
