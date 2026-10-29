#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/build/desktop"

if [ ! -d "$OUT" ]; then
    echo "error: desktop build missing; run make build first" >&2
    exit 1
fi

echo "==> starting Scratch Link protocol server"
cd "$ROOT"
TESSLO_LINK_HOST=127.0.0.1 TESSLO_LINK_PORT=20111 \
    node packages/scratch-link-ohos/src/cli.js &
LINK_PID=$!
trap 'kill "$LINK_PID" 2>/dev/null || true' EXIT

sleep 0.5

echo "==> launching Tesslo desktop"
cd "$ROOT/upstream/scratch-desktop"
NODE_ENV=production TESSLO_STATIC_DIR="$OUT/static" \
    env -u ELECTRON_RUN_AS_NODE npx electron "$OUT/main/main.js" "$@"
