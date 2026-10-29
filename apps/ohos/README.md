# apps/ohos

Minimal HarmonyOS HAP host for Tesslo.

- `electron/` — EntryAbility, window pages, and the C# Link start call.
- `web_engine/` — Electron-on-OHOS platform adapters, `TessloBleBind`, and the
  `BleTcpBridge` used by the C# link (127.0.0.1:20113).
- `electron/libs/arm64-v8a/` — Electron runtime, C# Link, NAPI bridge, `libc++_shared`
  (generated/local, gitignored).
- `.../resfile/` — Electron runtime data and the staged app payload (generated).

Build:

```sh
pnpm build
pnpm build:link:csharp
pnpm build:hap
pnpm dev:ohos -- --device <serial>
pnpm dev:ohos -- --ble-sim --device <serial>  # simulated micro:bit/WeDo
```
