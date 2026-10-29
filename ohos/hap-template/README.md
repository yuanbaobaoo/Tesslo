# HAP Template

HarmonyOS wrapper for Tesslo, based on the Electron-on-HarmonyOS shell from
zcode-ohos (Apache-2.0) and its Electron 41 runtime.

## Layout

```text
ohos/hap-template/
├── AppScope/                 # org.tesslo.app
├── electron/                 # entry module (zcode shell) + libs/arm64-v8a
├── web_engine/               # ArkTS HAR: window, JSBridge, runtime data
│   └── src/main/resources/resfile/
│       ├── icudtl.dat        # Electron runtime data
│       ├── *.pak
│       ├── v8_context_snapshot.bin
│       ├── locales/
│       └── resources/app/    # Tesslo app payload (generated)
├── account_quick_login/      # shell dependency
├── build-profile.json5
└── hvigorfile.ts
```

## Build

From the repository root:

```sh
make build          # desktop payload -> build/desktop
bash scripts/build-hap.sh
```

`scripts/build-hap.sh`:

1. stages `build/desktop` into `web_engine/.../resources/app/`;
2. writes the runtime `package.json` (`main: ./main/main.js`);
3. runs `devecocli signature generate` if no signing config exists;
4. runs `hvigorw assembleHap --no-daemon`.

Environment used locally:

```sh
export DEVECO_CLI_CLT_PATH=/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1
export DEVECO_SDK_HOME=$DEVECO_CLI_CLT_PATH/sdk
export JAVA_HOME=~/.sdkman/candidates/java/21.0.11-tem
```

Java is required by hvigor's `PackageHap` step (`app_packing_tool.jar`).

## Install

```sh
hdc install -r electron/build/default/outputs/default/electron-default-signed.hap
hdc shell aa start -a EntryAbility -b org.tesslo.app
```

## Runtime files (not committed)

The Electron runtime libs and data are third-party and large. They are
gitignored:

- `electron/libs/arm64-v8a/` — `libelectron.so`, `libadapter.so`,
  `libffmpeg.so`, `electron`
- `web_engine/src/main/resources/resfile/` — ICU/pak/snapshot/locales and the
  generated app payload

Obtain them from the Electron-on-HarmonyOS runtime distribution (or the
zcode-ohos reference project) before building.

## Known issue

The current Electron-on-HarmonyOS runtime/emulator combination returns
`null` for `canvas.getContext('webgl')` under every tested ANGLE/SwiftShader/
native GL flag combination. The Scratch UI loads and then shows the
WebGL-unsupported modal. See `docs/status.md`.
