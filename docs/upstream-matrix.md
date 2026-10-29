# Upstream Matrix

| Component | Pinned | Notes |
|---|---|---|
| `scratch-desktop` | `v3.32.0` (`cd3cf845a2f1cc597ae00c0ffd8d210c77cd648c`) | desktop shell, packaging, media fetch |
| `@scratch/scratch-gui` | `13.7.4-svg` | pinned by scratch-desktop; not the monorepo 15.x |
| `@scratch/scratch-vm` | `13.7.4-svg` | transitive |
| `@scratch/scratch-render` | `13.7.4-svg` | transitive |
| `@scratch/scratch-svg-renderer` | `13.7.4-svg` | transitive |
| `scratch-paint` | `4.1.52` | transitive (legacy package) |
| `scratch-storage` | `6.2.1` | transitive (legacy package) |
| `scratch-audio` | `2.0.268` | transitive |
| `scratch-blocks` | `2.1.19` | Apache-2.0 |
| `scratch-link` protocol | `1.3` | reimplemented in `packages/scratch-link-ohos` |
| Electron | `40.10.6` | local dev / OHOS runtime family |
| HarmonyOS SDK | `26` | HarmonyOS 7 |

## Update procedure

1. Change `scratch-desktop.tag` and `commit` in `upstream.lock.json`.
2. Run `make sync` and `make patch`.
3. If a patch conflicts, adapt the patch to upstream; do not modify upstream
   to fit a patch.
4. Run `make test` and the desktop smoke test.
5. Record the new matrix in this file and commit a `chore: sync upstream` PR.

## Notes

- Windows/macOS Scratch Desktop 3.32.0 ships GUI 13.7.4-svg, not 15.3.0.
- Following the latest `scratch-editor` is a different product decision; it
  breaks the "same as Scratch Desktop" guarantee until upstream updates its pin.
- Electron 40 is the target OHOS runtime family; local macOS builds use the
  same version for parity.
