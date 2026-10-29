#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/upstream/scratch-desktop"
OUT="$ROOT/build/desktop"

if [ ! -d "$DEST" ]; then
    echo "error: upstream not synced; run make sync first" >&2
    exit 1
fi

export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export npm_config_registry="${npm_config_registry:-https://registry.npmmirror.com}"

cd "$DEST"

echo "==> installing dependencies"
npm install --no-audit --no-fund

if [ "${SKIP_MEDIA:-0}" != "1" ]; then
    echo "==> fetching offline media library"
    if ! npm run fetch; then
        echo "warning: media fetch failed; continuing without static/fetched" >&2
    fi
else
    echo "==> skipping media fetch (SKIP_MEDIA=1)"
fi

echo "==> building scratch-desktop"
NODE_ENV=production npm run compile

echo "==> collecting artifacts into build/desktop"
rm -rf "$OUT"
mkdir -p "$OUT"
cp -R dist/main "$OUT/main"
cp -R dist/renderer "$OUT/renderer"
if [ -d static ]; then
    cp -R static "$OUT/static"
fi
cp package.json "$OUT/package.json"

echo "==> desktop build ready at $OUT"
