# Patch series

Patches are applied in order by `scripts/apply-patches.sh` against the exact
upstream commit in `upstream.lock.json`.

Naming:

- `NNNN-L1-...` platform / main process
- `NNNN-L2-...` renderer / HOC
- `NNNN-L3-...` Scratch Link / packaging

Rules:

- Keep each patch minimal and single-purpose.
- Never patch upstream to fit a patch; adapt the patch to upstream.
- Do not touch GUI internals in v1; keep `scratch-gui` as an npm dependency.
- Every patch must be listed in `series` and documented below.

## Patches

| Patch | Layer | Purpose |
|---|---|---|
| `0001-L1-pin-electron-40-and-branding.patch` | L1 | Electron 40.10.6, product name/description to Tesslo |
| `0002-L1-disable-telemetry.patch` | L1 | remove TelemetryClient from the main bundle (also drops electron-store/conf/ajv) |
| `0003-L1-ohos-paths-save-and-error-dialog.patch` | L1 | OHOS WebGL/ANGLE flags, static path candidates, `fileAccessPersist`, empty argv guard, IPC error dialog, main-process diagnostics |
| `0004-L2-remove-remote-dialog.patch` | L2 | replace legacy `remote.dialog` with IPC |
| `0005-L1-tesslo-splash.patch` | L1 | loading splash copy |
