#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

REPO="$(node -p "require('./upstream.lock.json').scratchDesktop.repo")"
TAG="$(node -p "require('./upstream.lock.json').scratchDesktop.tag")"
COMMIT="$(node -p "require('./upstream.lock.json').scratchDesktop.commit")"
DEST="$ROOT/upstream/scratch-desktop"

mkdir -p "$ROOT/upstream"

if [ ! -d "$DEST/.git" ]; then
    echo "==> cloning scratch-desktop into upstream/scratch-desktop"
    git clone --filter=blob:none --no-checkout "$REPO" "$DEST"
fi

echo "==> fetching $TAG ($COMMIT)"
if ! git -C "$DEST" fetch --depth 1 origin "$COMMIT" 2>/dev/null; then
    git -C "$DEST" fetch --depth 1 origin "refs/tags/$TAG:refs/tags/$TAG"
fi

git -C "$DEST" checkout -f "$COMMIT"

ACTUAL="$(git -C "$DEST" rev-parse HEAD)"
if [ "$ACTUAL" != "$COMMIT" ]; then
    echo "error: upstream SHA mismatch: expected $COMMIT, got $ACTUAL" >&2
    exit 1
fi

echo "==> upstream ready at $ACTUAL"
