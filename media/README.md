# Media Library

Tesslo needs an offline copy of Scratch's default media library (sprites,
costumes, backdrops, sounds). The upstream script
`scratch-desktop/scripts/fetchMediaLibraryAssets.js` downloads assets from
`cdn.assets.scratch.mit.edu`, which is not reliably reachable from mainland
China.

## Policy

- Do not commit fetched assets to git.
- Build from a mirror or a pre-populated cache.
- Record the source and checksum of the mirror in `media/manifest.json`.
- Verify asset licenses before redistribution.

## Layout

```text
media/
├── manifest.json     # source, file count, byte count
└── fetched/          # local offline assets (gitignored)
```

## Status

- `media/fetched` currently holds 1328 files (~57 MB); `media/manifest.json`
  records the count and total bytes.
- `pnpm build:hap` stages `media/fetched` into the HAP app payload as
  `static/fetched`.
- `apps/desktop/static/fetched` is a local symlink to `media/fetched` for
  desktop development.
- Assets stay out of git; copy or fetch them into `media/fetched` before an
  offline build.

## Licensing

The fetched assets are © Scratch Foundation. Their redistribution terms are
separate from the AGPL code license. Clear redistribution before publishing a
HAP that bundles them; for private builds keep the source host recorded.
