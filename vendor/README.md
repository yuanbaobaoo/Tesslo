# Vendor Assets

This directory separates source from binary artifacts.

## Source

Scratch source is copied into the repository, not fetched at build time:

- `packages/scratch-*` — editor and legacy Scratch packages
- `apps/desktop` — scratch-desktop shell
- `apps/ohos` — minimal HAP host
- `packages/link/dotnet` — C# Scratch Link implementation
- `vendor/scratch-link-csharp` — upstream C# Scratch Link, reference only
- `vendor/ohos-net` — OHOS NativeAOT toolchain, runtime targets, and hello sample
- `vendor/upstream.lock.json` — repo/tag/commit for every vendored source

## Binaries

Native/runtime artifacts are not committed to git and are not stored with Git LFS:

- `vendor/electron-ohos.lock.json` — Electron OHOS runtime version, SHA-256,
  size, and the Tesslo release-asset URL
- `vendor/ohos-net.lock.json` — NativeAOT runtime pack version, SHA-256, and
  local toolchain changes
- `vendor/cache/` — local, gitignored cache populated from those assets

`.so` files and the NativeAOT runtime pack never enter git normal files.

## Offline builds

1. Populate `vendor/cache/` and the OHOS runtime/toolchain cache once.
2. Run `pnpm install --offline --store-dir <local-store>`.
3. Run `pnpm build`, `pnpm build:link:csharp`, and `pnpm build:hap` with no
   network access.

The source tree and offline package store are sufficient for a build; no upstream
GitHub repository is contacted.
