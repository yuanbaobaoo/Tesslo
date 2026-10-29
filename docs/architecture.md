# Architecture

## Layers

```text
apps/desktop                 scratch-desktop source (Electron main/renderer)
packages/scratch-*           vendored Scratch editor packages
packages/link                TypeScript Scratch Link (desktop fallback)
packages/link/dotnet         C# Scratch Link server (HAP runtime)
apps/ohos                    minimal HarmonyOS HAP host
  electron                   EntryAbility + window pages + C# Link start
  web_engine                 Electron-on-OHOS platform adapters + BLE bridge
vendor/ohos-net              OHOS NativeAOT runtime/toolchain
```

## Build pipeline

```text
Scratch packages -> scratch-gui dist -> desktop dist -> HAP app payload
C# link server -> TessloLinkNative.so -> NAPI bridge -> apps/ohos libs
```

- `pnpm build` builds the GUI and desktop `dist` from in-repo sources.
- `pnpm build:link:csharp` publishes the C# NativeAOT library, builds the NAPI
  bridge, and deploys all native libraries into `apps/ohos/electron/libs`.
- `pnpm build:hap` stages `dist`, `media/fetched`, and the link bridge into the
  HAP, then runs hvigor. Default output is unsigned.
- `pnpm dev:ohos` builds a signed HAP, installs it with `hdc`, starts
  `EntryAbility`, and collects the main log plus a screenshot.

## Scratch Link

- C# server listens on `127.0.0.1:20111`.
- `EntryAbility` starts it through the NAPI bridge.
- Electron main detects `libtesslolink.so` and skips the TypeScript link.
- BLE operations go through `BleTcpBridge.ets` on `127.0.0.1:20113`:
  ArkTS owns `@ohos.bluetooth.ble`; C# owns the Scratch Link protocol.
- The TypeScript server remains the desktop fallback.

## Upstream source

All Scratch source is vendored under `packages/` and `apps/desktop`. The build
does not clone or fetch an upstream repository. Exact revisions are recorded in
`vendor/upstream.lock.json`; the OHOS runtime is pinned in
`vendor/electron-ohos.lock.json` and `vendor/ohos-net.lock.json`.
