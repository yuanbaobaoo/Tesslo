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
- The server is implemented in `packages/link`.
- Production transport will be an ArkTS BLE/BT bridge; the current adapter is a
  fake device used for protocol tests and UI wiring.

## Upstream boundaries

| Upstream | Pinned | How it enters the build |
|---|---|---|
| `scratch-desktop` | v3.32.0 / cd3cf84 | vendored in `apps/desktop` |
| `@scratch/scratch-gui` | 13.7.4-svg | vendored in `packages/scratch-gui`, built from source |
| scratch-vm / render / svg-renderer / paint / storage / audio / blocks / l10n / fonts / parser / sb1 / task-herder | see `vendor/upstream.lock.json` | vendored under `packages/` |
| Electron | 40.10.6 | npm devDependency; OHOS runtime is an external asset |
| Scratch Link protocol | 1.3 | C# source in `vendor/scratch-link-csharp`; TS implementation in `packages/link` |

## Downstream changes

- Source is edited directly in `packages/` and `apps/`; there is no build-time
  patch application.
- Keep `[downstream]` changes small and record them in commits.
- GUI edits are allowed, but should stay minimal and be rebuildable from source.
