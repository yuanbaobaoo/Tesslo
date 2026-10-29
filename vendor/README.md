# Vendor Assets

This directory separates source from binary artifacts.

## Source

Scratch source is copied into the repository, not fetched at build time:

- `packages/scratch-*` — editor and legacy Scratch packages
- `apps/desktop` — scratch-desktop shell
- `vendor/scratch-link-csharp` — upstream C# Scratch Link, reference only
- `vendor/upstream.lock.json` — repo/tag/commit for every vendored source

## Binaries

Native/runtime artifacts are not committed to git and are not stored with Git LFS:

- `vendor/electron-ohos.lock.json` — Electron OHOS runtime version, SHA-256,
  size, and the Tesslo release-asset URL
- `vendor/cache/` — local, gitignored cache populated from that asset

`pnpm build:hap` consumes `vendor/cache/` and fails with instructions if the
runtime archive is missing. `.so` files never enter git.

## Offline builds

1. Populate `vendor/cache/` once (download the pinned asset and verify SHA-256).
2. Run `pnpm install --offline --store-dir <local-store>`.
3. Run `pnpm build` or `pnpm build:hap` with no network access.

The source tree and the offline package store are sufficient for a build; no
upstream GitHub repository is contacted.
