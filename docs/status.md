# Status

Last updated: 2026-10-29

## Works

### Editor and desktop

- Scratch editor source is vendored under `packages/`; the desktop shell is in
  `apps/desktop`.
- `pnpm build` builds `packages/scratch-gui/dist` and `apps/desktop/dist` from
  in-repo sources.
- Desktop smoke and the real-device HAP render the Scratch editor with WebGL.

### HarmonyOS HAP

- `apps/ohos` is the minimal HAP host: Electron-on-HarmonyOS runtime sample,
  Tesslo `web_engine`, no app-layer login/status-bar modules.
- `pnpm build:hap` produces an unsigned HAP; `pnpm dev:ohos` signs, installs,
  launches, and writes evidence to `build/verify/`.
- Verified on a real HarmonyOS 7 device (`59C0225513001654`):
  `webgl probe {"webgl":true,"webgl2":true}` and the full Scratch UI renders.

### Scratch Link

- C# server: `packages/link/dotnet`; protocol 1.3 over WebSocket on 20111.
- NativeAOT `TessloLinkNative.so` is loaded through the NAPI bridge
  `libtesslolink.so`; `EntryAbility` starts it and Electron skips the JS link.
- Verified on device: `getVersion`, `discover`.
- Real BLE scan through the ArkTS TCP bridge
  (`web_engine/src/main/ets/ble/BleTcpBridge.ets`, port 20113); 43–75 devices
  observed.
- GATT connect/getServices/read/write/start-stopNotifications are implemented
  over the same bridge.
- Simulated `BBC micro:bit [tesslo]` and `LEGO WeDo 2.0 [tesslo]` peripherals
  pass discover → connect → getServices → notify/read/write end-to-end.

## Pending

- micro:bit / WeDo hardware GATT regression (needs physical devices).
- BT Classic / EV3.
- Full Scratch Link state-machine parity: timeouts, disconnects, error codes.
- CI for build/test/HAP; offline HMOS `oh_modules` and NativeAOT runtime assets.
- AppGallery, AGPL source bundle, trademark and media licensing.
- Manual `.sb3` save/reopen on a real device.

## Known constraints

- HarmonyOS 7+ only (`compatibleSdkVersion` 26).
- JIT ACL `ohos.permission.kernel.ALLOW_WRITABLE_CODE_MEMORY` is required for the
  Electron route.
- The HAP runtime needs the Electron-on-HarmonyOS libs and the C# link libs,
  which are local/gitignored assets.
- `pnpm build:hap` expects `pnpm build:link:csharp` to have run first.

## Verification commands

```bash
pnpm build
pnpm test
pnpm build:link:csharp
pnpm build:hap
pnpm dev:ohos -- --device <serial>
pnpm test:ble -- --device microbit
pnpm test:ble -- --device wedo
```
