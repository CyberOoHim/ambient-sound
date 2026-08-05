---
name: freesound-import
description: Guides and automates importing audio sounds from Freesound.org into sounds.json, processing audio preview files, and validating manifests while preserving existing binary sound assets.
---

# Freesound Import Skill

Use this skill when the user requests adding or importing sound effects from Freesound.org into `config/sounds.json`. Inputs may be titles, descriptions, screenshots of Freesound pages, or direct URLs/IDs.

## Full Reference

Read [docs/FREESOUND_IMPORT_GUIDE.md](docs/FREESOUND_IMPORT_GUIDE.md) for complete details before proceeding. Key points summarized below.

## Workflow

### 1. Identify Sounds on Freesound
- Search `https://freesound.org/search/?q=<query>` or fetch the sound page HTML directly.
- Extract: `freesoundId`, `username`, `originalTitle`, `license` (SPDX), `previewPath` (HQ mp3), `pageUrl`.
- The `previewPath` prefix directory is the **first 3 digits** of the freesoundId (e.g., `442211` → `previews/442/...`).

### 2. Add Entry to `config/sounds.json`
- Create a JSON object with all required fields: `id`, `title`, `category`, `tags`, `freesoundId`, `username`, `originalTitle`, `license`, `previewPath`, `pageUrl`, `maxSec`, `crossfadeMs`.
- Optional: set `"loopMode": "native"` for seamlessly looping sounds (default is `"crossfade"`).
- Place entry near related sounds (e.g., transport sounds together).

### 3. Verify License Support
- Check that the SPDX license string is in the `ALLOWED` set in `scripts/validate-manifests.mjs`.
- Check that the license URL is mapped in `LICENSE_URLS` in `scripts/fetch-freesound-core.mjs`.
- If not present, add the new license to both files.

### 4. Fetch, Validate, Build
```bash
node scripts/fetch-freesound-core.mjs
node scripts/validate-manifests.mjs
npm run build
```
Or using pnpm aliases:
```bash
pnpm sounds:freesound
pnpm validate-manifests
pnpm build
```

### 5. Verify Non-Disruptive Changes
```bash
git status --short
```
- Only **new** `.ogg` files should appear as untracked.
- Only `sounds.json`, `catalog.json`, `ATTRIBUTIONS.md` (and possibly script files) should be modified.
- **No pre-existing `.ogg` files should be modified.** The script skips encoding when the output `.ogg` already exists.

## Critical Warnings

> [!WARNING]
> **Orphan cleanup:** The fetch script deletes any `.ogg` in `public/sounds/core/` that has no matching entry in `config/sounds.json`. Never remove an entry from `sounds.json` unless you intend to delete its audio file.

> [!WARNING]
> **Do not confuse scripts:** `generate-core-pack.mjs` generates procedural placeholder sounds and is **not** used for Freesound imports. Use only `fetch-freesound-core.mjs`.

> [!IMPORTANT]
> **Presets cross-validation:** `validate-manifests.mjs` also checks that `config/default-presets.json` only references valid asset IDs from the catalog. Adding a new sound does not break presets, but removing one that a preset references will.
