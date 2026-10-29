#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/ohos/hap-template"
APP="$TEMPLATE/web_engine/src/main/resources/resfile/resources/app"
DESKTOP="$ROOT/build/desktop"

export DEVECO_CLI_CLT_PATH="${DEVECO_CLI_CLT_PATH:-/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1}"
export DEVECO_SDK_HOME="${DEVECO_SDK_HOME:-$DEVECO_CLI_CLT_PATH/sdk}"
export JAVA_HOME="${JAVA_HOME:-/Users/admin/.sdkman/candidates/java/21.0.11-tem}"
export PATH="$JAVA_HOME/bin:$DEVECO_CLI_CLT_PATH/bin:$DEVECO_CLI_CLT_PATH/sdk/default/openharmony/toolchains:$PATH"

if [ ! -d "$DESKTOP" ]; then
    echo "==> desktop build missing; building"
    bash "$ROOT/scripts/build-desktop.sh"
fi

echo "==> bundling Scratch Link server"
npm --prefix "$ROOT/packages/scratch-link-ohos" run build >/dev/null

echo "==> staging desktop payload into HAP"
rm -rf "$APP"
mkdir -p "$APP"
cp -R "$DESKTOP/main" "$APP/main"
cp -R "$DESKTOP/renderer" "$APP/renderer"
cp -R "$DESKTOP/static" "$APP/static"
cp "$ROOT/packages/scratch-link-ohos/dist/scratch-link.cjs" "$APP/scratch-link.cjs"
find "$APP" -name "*.map" -delete
cat > "$APP/package.json" <<'JSON'
{
  "name": "tesslo",
  "productName": "Tesslo",
  "version": "0.1.0",
  "description": "Tesslo - an unofficial, Scratch-compatible block editor for HarmonyOS 7",
  "main": "./main/main.js",
  "private": true,
  "license": "AGPL-3.0-only"
}
JSON

cd "$TEMPLATE"

if [ ! -f build-profile.json5 ]; then
    echo "==> restoring build-profile.json5 from template"
    cp build-profile.template.json5 build-profile.json5
fi

if ! grep -q "signingConfigs" build-profile.json5; then
    echo "==> generating local signing material (device/account bound; do not commit)"
    devecocli signature generate --product default
fi

echo "==> building HAP"
hvigorw assembleHap --no-daemon

HAP="$TEMPLATE/electron/build/default/outputs/default/electron-default-signed.hap"
if [ -f "$HAP" ]; then
    echo "==> HAP ready: $HAP"
else
    echo "error: signed HAP not found; check hvigor output" >&2
    exit 1
fi
