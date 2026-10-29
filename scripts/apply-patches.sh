#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

COMMIT="$(node -p "require('./upstream.lock.json').scratchDesktop.commit")"
DEST="$ROOT/upstream/scratch-desktop"
SERIES="$ROOT/patches/series"

if [ ! -d "$DEST/.git" ]; then
    echo "error: upstream not synced; run scripts/sync-upstream.sh first" >&2
    exit 1
fi

git -C "$DEST" checkout -f "$COMMIT"

if [ ! -f "$SERIES" ]; then
    echo "==> no patches/series; upstream left clean"
    exit 0
fi

while IFS= read -r patch; do
    patch="${patch%%#*}"
    patch="$(echo "$patch" | xargs)"
    [ -z "$patch" ] && continue
    if [ ! -f "$ROOT/patches/$patch" ]; then
        echo "error: missing patch patches/$patch" >&2
        exit 1
    fi
    echo "==> applying patches/$patch"
    git -C "$DEST" apply --3way "$ROOT/patches/$patch"
done < "$SERIES"

echo "==> patches applied"
