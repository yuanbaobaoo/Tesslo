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

## Planned layout

```text
media/
├── manifest.json     # asset host, counts, checksums
└── fetch.mjs         # downloads into scratch-desktop/static/fetched
```

## Status

Implemented using the upstream fetcher:

```sh
cd upstream/scratch-desktop
npm run fetch     # writes static/fetched
```

- 1328 files, ~58 MB; every one of the 2679 library items resolves to a file.
- `build-desktop.sh` copies `static/fetched` into `build/desktop/static`, and
  `build-hap.sh` packages it into the HAP.
- Assets stay out of git (`static/fetched` is ignored); rebuilds fetch them again
  or reuse a cache.

## Licensing

The fetched assets are © Scratch Foundation. Their redistribution terms are
separate from the AGPL code license. Clear redistribution before publishing a
HAP that bundles them; for private builds keep the source host recorded.
