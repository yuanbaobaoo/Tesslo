# Architecture

## Layers

```text
HarmonyOS 7 HAP
└── Electron 40 on HarmonyOS
    ├── Main process (scratch-desktop shell + Tesslo patches)
    │   ├── windows, dialogs, downloads, permissions
    │   ├── offline static assets (static/fetched)
    │   └── Scratch Link server (ws://127.0.0.1:20111)
    ├── Renderer (scratch-gui 13.7.4-svg prebuilt bundle)
    │   └── scratch-vm / render / paint / blocks / audio
    └── ArkTS bridge
        └── HarmonyOS Connectivity Kit (BLE / BT)
```

## Why this shape

- `scratch-desktop` is the official desktop shell. Reusing it preserves the
  Windows/macOS experience: menus, dialogs, save flow, offline media, and the
  desktop HOCs.
- The editor is a prebuilt npm bundle (`@scratch/scratch-gui` main is
  `dist/scratch-gui.js`). It does not need per-module HarmonyOS ports.
- The only platform-specific core component is the hardware bridge:
  Scratch Link is C#/.NET and cannot run on HarmonyOS, so Tesslo implements
  the documented Scratch Link protocol itself.

## Scratch Link

- WebSocket on `127.0.0.1:20111`
- JSON-RPC 2.0, protocol 1.3
- Paths: `/scratch/ble`, `/scratch/bt`
- The VM tries `ws://127.0.0.1:20111` first, so no DNS workaround is required.
- The server is implemented in `packages/scratch-link-ohos`.
- Production transport will be an ArkTS BLE/BT bridge; the current adapter is a
  fake device used for protocol tests and UI wiring.

## Upstream boundaries

| Upstream | Pinned | How it enters the build |
|---|---|---|
| `scratch-desktop` | v3.32.0 / cd3cf84 | source + patch series |
| `@scratch/scratch-gui` | 13.7.4-svg | npm dependency of scratch-desktop |
| Electron | 40.10.6 | npm devDependency / OHOS runtime |
| Scratch Link protocol | 1.3 | reimplemented |

## Patch boundaries

- L1: main process (paths, dialogs, save, permissions, telemetry)
- L2: renderer HOC (`remote` removal, storage init)
- L3: packaging (HAP layout, permissions, signing)
- No GUI internal patches in v1.
