# apps/ohos

Minimal HarmonyOS HAP host for Tesslo.

- `electron/` — EntryAbility, window pages, and the C# Link start call.
- `web_engine/` — Electron-on-OHOS platform adapters and `TessloBleBind`.
- `electron/libs/arm64-v8a/` — Electron runtime, C# Link, NAPI bridge, `libc++_shared`
  (generated/local, gitignored).
- `.../resfile/` — Electron runtime data and the staged app payload (generated).

Build:

```sh
pnpm build
pnpm build:link:csharp
pnpm build:hap
pnpm dev:ohos -- --device <serial>
```
