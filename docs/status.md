# Implementation Status

Last updated: 2026-10-29

> 2026-10-29 migration note: the editor and desktop shell are now vendored under
> `packages/` and `apps/desktop`, and the build entry points are `pnpm build`,
> `pnpm build:hap`, and `pnpm dev:ohos`. The older `make` / patch-series commands
> in the historical sections below describe the previous PoC only.

## What works

### Source monorepo (2026-10-29)

- Scratch editor source is vendored under `packages/`; the desktop shell is in
  `apps/desktop`; `pnpm build` builds the GUI and desktop `dist` without cloning
  an upstream repository.
- `pnpm build:hap` produces an unsigned HAP; `pnpm dev:ohos -- --device <serial>`
  builds the signed HAP, installs it, launches `EntryAbility`, and writes the
  main log plus a screenshot to `build/verify/`.
- Validated on a real HarmonyOS 7 device (`59C0225513001654`):
  `webgl probe {"webgl":true,"webgl2":true}` and the full Scratch editor
  (blocks, stage, sprite) renders from the source-built GUI.
- The HAP host in `apps/ohos` is the minimal Tesslo host: vendor runtime sample,
  Tesslo web_engine fixes, no quick-login/StatusBar app layer. It builds and
  launches on the real device.

### Scratch Link: C# server on device

- Runtime: .NET 9.0.104 NativeAOT, OHOS API 26, arm64.
- C# implementation: `packages/link/dotnet` (protocol server) + `Tesslo.Link.Native`
  (C exports) + `napi/libtesslolink.so` (NAPI bridge).
- The ArkTS `EntryAbility` starts the C# server on `127.0.0.1:20111`; the Electron
  main process detects `libtesslolink.so` and skips the JS link server.
- Verified on the real device: `getVersion` → `1.3`, `discover` →
  `didDiscoverPeripheral`. The handshake uses a managed SHA-1 because the OHOS
  runtime pack has no `libcrypto.so`.
- BLE scan is real: ArkTS exposes `@ohos.bluetooth.ble` through a local TCP bridge
  (`127.0.0.1:20113`), and C# `discover` filters the results (75 devices observed).
- GATT connect/getServices/read/write/notifications are implemented over the same
  bridge; they still need micro:bit/WeDo hardware regression. BT Classic is not
  implemented yet. The TS server remains the desktop fallback.

### Desktop (macOS, Electron 40.10.6)

- Upstream: `scratch-desktop` v3.32.0 (`cd3cf845...`), GUI `13.7.4-svg`.
- Build: `make build` / `scripts/build-desktop.sh`
  - `build/desktop/main/main.js`
  - `build/desktop/renderer/`
  - `build/desktop/static/`
- Smoke: `scripts/smoke-desktop.sh`
  - loads `file://.../renderer/index.html`
  - Chinese UI, block palette, stage canvas present
  - Scratch Link server starts on `127.0.0.1:20111`

Evidence: `build/smoke.log` and the main-process file log.

Reproducibility: `scripts/sync-upstream.sh` + `scripts/apply-patches.sh` were re-run from the pinned commit `cd3cf845`; patches 0001-0008 applied cleanly, the production compile succeeded, and the desktop smoke test passed afterwards.

### Device VM smoke

With a temporary `--remote-debugging-port=9222` (removed afterwards) and `hdc fport`, the renderer VM was reached over CDP:

- `vm.loadProject()` loaded a generated `.sb3` with `Stage` + `TessloSprite` (x=10, y=20).
- `vm.saveProjectSb3()` produced a 2441-byte `application/x.scratch.sb3` blob with a valid ZIP signature.

This validates project parsing/serialization and asset loading on the HAP; stage drawing still depends on WebGL.

### Scratch Link protocol server

- `packages/link`
- WebSocket JSON-RPC 2.0, protocol 1.3
- paths `/scratch/ble`, `/scratch/bt`
- fake BLE/BT transport
- `npm test` (root): 9/9 passing, including 4 `OhosBleAdapter` tests (scan filtering, connect/services/read/write/notify, permission denial, Bluetooth-off error) with an injected bridge
- Embedded in the HAP: `scripts/build-hap.sh` bundles the server with esbuild to `link.cjs`; the Electron main process starts it on `127.0.0.1:20111` when running on HarmonyOS.
- Device verification (HarmonyOS 7.0 2in1, `hdc fport tcp:20111 tcp:20111` from the host): `getVersion` → `1.3`, `discover` → fake micro:bit, `connect`, `getServices`, `write`, `read`, `startNotifications` + `characteristicDidChange` all pass.
- Real BLE transport (ArkTS Connectivity Kit bridge) is still pending.

### HarmonyOS HAP

- Template: `apps/ohos`
- Runtime: Electron 40.1.0 / Chromium 144 from Huawei's `electron-ohos-v40.0.1.20260928.2` (`libelectron.so`, `libadapter.so`, `libffmpeg.so`, `electron`) plus runtime data (`icudtl.dat`, paks, `v8_context_snapshot.bin`, locales, vulkan).
- Shell: Electron-on-HarmonyOS runtime sample + Tesslo `web_engine`, bundled as `org.tesslo.app`; app label is Tesslo.
- API floor: `compatibleSdkVersion: '26.0.0'`, packaged `minAPIVersion=260000026`, so the HAP installs only on HarmonyOS 7+. Verified on the HarmonyOS 6.1.0 emulator: install is rejected with `9568297 install failed due to older sdk version in the device`.
- Platform adaptations:
  - `CertManagerAdapter.getCertCrl` short-circuits: CRL scanning crashed the process on API 26 and Scratch does not use CRLs.
  - The shell no longer forces `--use-gl=egl`; the main process selects `--use-gl=angle --use-angle=gl`. This fixes the black window on the 7.0 2in1 emulator (patch 0006).
  - WebUSB picker window is not created on HarmonyOS; BLE goes through Scratch Link (patch 0006).
  - The shell no longer adds `--in-process-gpu` on tablets: that switch crashed `Chrome_InProcGp` on the 7.0 tablet profile. Both 7.0 tablet and 2in1 emulators now launch and render the UI.
- Build:
  ```sh
  export JAVA_HOME=~/.sdkman/candidates/java/21.0.11-tem
  export PATH="$JAVA_HOME/bin:/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1/bin:$PATH"
  export DEVECO_SDK_HOME=/Users/Shared/local/ohos/command-line-tools_26.0.0_Beta1/sdk
  cd apps/ohos
  devecocli signature generate --product default   # writes local signingConfigs; do not commit
  hvigorw assembleHap --no-daemon
  ```
- Emulators tested: HarmonyOS 7.0.0 (API 26) MatePad Pro 13 (tablet, `:5555`) and MateBook Pro (2in1, `:5557`).
- Install/launch:
  ```sh
  hdc install -r electron/build/default/outputs/default/electron-default-signed.hap
  hdc shell aa start -a EntryAbility -b org.tesslo.app
  ```
- GL backend is selected at runtime: `deviceInfo.productModel === 'emulator'` → ANGLE (`use-gl=angle/use-angle=gl`, UI renders without WebGL); real devices → native `--use-gl=egl` (full WebGL).
- Result on 7.0 tablet (MatePad Pro 13) and 2in1 (MateBook Pro): `process.platform=ohos`, Electron main + NetworkService + Renderer start, main window plus About/Privacy windows are created, `webgl probe {"webgl":false,"webgl2":false}` is logged, and the process stays alive.
- Packaging: unused reference payloads are removed and renderer source maps are stripped while staging.
- Scratch GUI renders fully with ANGLE GL (Chinese UI, block palette, menus) behind the WebGL-unsupported modal.

## Blockers

### 1. WebGL: works on real hardware, absent on emulators

On a real HarmonyOS 7.0 device (HAD-W32, API 26) with the shell's native EGL backend, the probe reports:

```text
webgl probe {"webgl":true,"webgl2":true,"renderer":"WebKit WebGL","vendor":"WebKit"}
gpu status {webgl:"enabled", gpu_compositing:"enabled", rasterization:"enabled", ...}
```

The full editor renders, including the stage and sprite. The ANGLE override was the problem: it made Chromium disable GPU access ("GPU access is disabled due to frequent crashes"). It is removed; the shell passes `--use-gl=egl` again.

On both HarmonyOS 7.0 emulator profiles the probe is still `null` (ANGLE keeps the UI visible):
- Electron renderer: ANGLE GL and `swiftshader-webgl` both return `null`; the UI and compositing work with ANGLE GL.
- An ArkWeb probe page in the same HAP also reports `webgl=false webgl2=false` (Chrome/144 ArkWeb/7.0.0.105), so the emulator image itself has no WebGL backend.

The failure is not Tesslo-specific: a stock Electron-on-HarmonyOS HAP with the same runtime also crashes in `Chrome_InProcGp` on the 7.0 tablet emulator.

Real-device verification: `scripts/verify-hap.sh <hdc-target>` installs, launches, and writes the main log plus a screenshot to `build/verify/`; pass means `webgl probe {"webgl":true`. Confirmed on HAD-W32.

### 2. Media library

Fetched with the upstream script: 1328 files (~58 MB), all 2679 library items resolve. Assets are packaged into the desktop build and the HAP. Redistribution terms still need to be cleared before publishing (see `media/README.md`).

On device the library modal opens and lists sprites/categories, and the renderer can read the fetched assets (`process.resourcesPath` ends at `.../resources`, so the helper now checks `app/static/fetched`; patch 0008). Thumbnails stay blank on the emulator because Scratch renders them through the missing WebGL path, not because of asset lookup.

### 3. Scratch Link hardware

The fake BLE/BT transport is embedded in the HAP and verified end-to-end on device.

Real BLE is implemented through the Electron OHOS ArkTS bridge:
- `web_engine/.../jsbindings/TessloBleBind.ets` exposes scan/connect/services/read/write/subscribe over JSON strings, backed by the shell's `BluetoothLowEnergyAdapter`.
- `packages/link/src/ohos-ble.js` detects `systemPreferences.callArkTSFunction`, requests `ohos.permission.ACCESS_BLUETOOTH`, and maps the JSON events to Scratch Link BLE methods.
- Verified on the 7.0 2in1 emulator: the permission prompt appears with the Tesslo name and reason, the ArkTS scan call runs, and the emulator reports `Bluetooth disabled` (no BLE hardware).
- Bridge semantics verified on device with `PermissionManagerAdapter.CheckPermissions`: the call resolves to `{type:"void",value:0}` while the callback receives a raw boolean, so JSON/string callbacks used by the BLE adapter are passed unwrapped.
- Remaining: connect/read/write/notify against a real micro:bit or WeDo on a physical device; BLE must be enabled.

### 4. File I/O

Save was exercised on the 7.0 2in1 emulator through the real UI: `文件 → 保存到电脑` opens the system picker with `Scratch作品.sb3` and the `Scratch 3 Project (*.sb3)` filter. The system picker ignores synthetic taps, so the final write and the open-project path still need a human tap on a real device.

## Repo hygiene

- Local signing material is not committed. Run `devecocli signature generate --product default` to regenerate.
- Runtime libs, HAP builds, `oh_modules`, `.hvigor` and the app payload are gitignored.
- The Electron-on-HarmonyOS runtime sample and `web_engine` are attributed in `NOTICE`.

## Handoff

Working on emulators (HarmonyOS 7.0 tablet + 2in1):
- install/launch, ANGLE GL UI, Scratch UI + library modal, offline assets readable, VM project load/save, Scratch Link fake transport plus ArkTS BLE bridge/permission flow, save dialog, API-26-only enforcement.

Pending on a real HarmonyOS 7 device:
1. WebGL probe (`scripts/verify-hap.sh <serial>`); if `false`, capture the probe, API version and any cppcrash log.
2. micro:bit/WeDo BLE connect, read/write, notifications with Bluetooth enabled.
3. One manual `.sb3` save and reopen (system pickers reject synthetic input).

No changes are committed; the patch series 0001-0008 replays cleanly on `cd3cf845`.
