# Upstream Matrix

All Scratch source needed by the build is vendored under `packages/` or `apps/`;
`vendor/upstream.lock.json` records the exact upstream revision. The build does
not clone or fetch an upstream Git repository.

| Component | Pinned | Local path | Notes |
|---|---|---|---|
| `scratch-desktop` | `v3.32.0` (`cd3cf845a2f1cc597ae00c0ffd8d210c77cd648c`) | `apps/desktop` | Electron shell; product version is maintained locally |
| `@scratch/scratch-gui` | `13.7.4-svg` | `packages/scratch-gui` | pinned by scratch-desktop; not the 15.x line |
| `@scratch/scratch-vm` | `13.7.4-svg` | `packages/scratch-vm` | same `scratch-editor` tag |
| `@scratch/scratch-render` | `13.7.4-svg` | `packages/scratch-render` | same `scratch-editor` tag |
| `@scratch/scratch-svg-renderer` | `13.7.4-svg` | `packages/scratch-svg-renderer` | same `scratch-editor` tag |
| `@scratch/task-herder` | `12.7.1` | `packages/task-herder` | version required by `scratch-storage` |
| `scratch-paint` | `4.1.52` | `packages/scratch-paint` | legacy package |
| `scratch-storage` | `6.2.1` | `packages/scratch-storage` | legacy package |
| `scratch-audio` | `2.0.268` | `packages/scratch-audio` | webpack 4 |
| `scratch-blocks` | `2.1.19` | `packages/scratch-blocks` | Apache-2.0 |
| `scratch-l10n` | `6.1.72` | `packages/scratch-l10n` | webpack 4 |
| `scratch-render-fonts` | `1.0.252` | `packages/scratch-render-fonts` | main points at `src/` |
| `scratch-parser` | `6.0.0` | `packages/scratch-parser` | source tag carries `0.0.0-development`; local version is pinned to 6.0.0 |
| `scratch-sb1-converter` | `2.0.279` | `packages/scratch-sb1-converter` | build produces `playground/main.js` |
| `scratch-link` | `v2.1.0-develop.10` (`4da54e14...`) | `vendor/scratch-link-csharp` | C# reference only; protocol 1.3 |
| C# link implementation | local | `packages/link/dotnet` | HAP runtime server |
| TS link implementation | local | `packages/link` | desktop fallback |
| Electron | `40.10.6` | `apps/desktop` | local desktop builds |
| Electron OHOS runtime | `40.0.1.20260928.2` | `vendor/electron-ohos.lock.json` | binaries are external assets, not git |
| OHOS NativeAOT runtime | `OpenHarmony.NET.Runtime 0.0.0-alpha.19` | `vendor/ohos-net.lock.json` | .NET 9 / API 26 / arm64 |
| HarmonyOS SDK | `26` | host toolchain | HarmonyOS 7 |

## Version policy

- The product version lives in the root `package.json` and `apps/desktop`.
- Internal package versions stay at their upstream values so workspace links
  remain exact; upstream revision is tracked in `vendor/upstream.lock.json`.
- When an upstream package changes, update both its source snapshot and the lock
  entry. Do not rely on an npm registry version to silently override the source.

## Update procedure

1. Fetch the desired upstream tag into a staging directory.
2. Copy the package source into `packages/<name>` (exclude `.git`, `node_modules`,
   `dist`, and build output).
3. Update `vendor/upstream.lock.json` with the new tag and commit.
4. Run `pnpm install`, `pnpm build`, and `pnpm test`.
5. Record the new matrix in this file.

## Notes

- Windows/macOS Scratch Desktop 3.32.0 ships GUI `13.7.4-svg`, not 15.3.0.
- Following the latest `scratch-editor` is a separate product decision; it breaks
  the "same as Scratch Desktop" guarantee until upstream moves its pin.
- Electron 40 is the target OHOS runtime family; local macOS builds use the same
  version for parity.
