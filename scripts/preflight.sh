#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Tesslo preflight"
node -v
npm -v
git --version

echo
echo "==> upstream lock"
cat upstream.lock.json

echo
echo "==> patches"
if [ -f patches/series ]; then
    grep -v '^#' patches/series | sed '/^$/d' || true
else
    echo "(empty)"
fi

echo
echo "==> tooling"
for t in devecocli hdc; do
    if command -v "$t" >/dev/null 2>&1; then
        echo "$t: $(command -v "$t")"
    else
        echo "$t: missing"
    fi
done
