#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/build/desktop"
LOG="$ROOT/build/smoke.log"

if [ ! -d "$OUT" ]; then
    echo "error: build/desktop missing; run make build first" >&2
    exit 1
fi

mkdir -p "$ROOT/build"

echo "==> starting Scratch Link protocol server"
cd "$ROOT"
TESSLO_LINK_HOST=127.0.0.1 TESSLO_LINK_PORT=20111 \
    node packages/scratch-link-ohos/src/cli.js > "$ROOT/build/scratch-link.log" 2>&1 &
LINK_PID=$!
trap 'kill "$LINK_PID" 2>/dev/null || true' EXIT

sleep 0.5

echo "==> launching Tesslo smoke test"
cd "$ROOT/upstream/scratch-desktop"
set +e
NODE_ENV=production \
TESSLO_STATIC_DIR="$OUT/static" \
TESSLO_SMOKE=1 \
    env -u ELECTRON_RUN_AS_NODE npx electron "$OUT/main/main.js" 2>&1 | tee "$LOG"
STATUS=${PIPESTATUS[0]}
set -e

if [ "$STATUS" -ne 0 ]; then
    echo "error: Electron exited with $STATUS" >&2
    exit "$STATUS"
fi

grep -q '\[tesslo-smoke\] renderer' "$LOG"
echo "==> smoke test passed"
