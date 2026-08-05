# Freesound Import Guide for AI Agents

This guide details the procedure for AI agents (and human maintainers) to discover, configure, fetch, and validate ambient sound effects from **Freesound.org** into the `ambient-sound` project.

---

## 1. Input Recognition

User requests may present sound targets in various formats:
- **Title / Description:** e.g., `"Add the steam train sound clickety clack from Freesound"`
- **Screenshot / Image:** Showing search results or sound details on Freesound.
- **Freesound URL or Sound ID:** e.g., `https://freesound.org/people/username/sounds/123456/` or `#123456`.

---

## 2. Metadata Extraction

If given titles, descriptions, or screenshots:
1. **Locate Sound Page:**
   Search Freesound via search queries (`https://freesound.org/search/?q=<query>`) or scrape search result HTML to find the canonical sound page URL:
   `https://freesound.org/people/<username>/sounds/<freesoundId>/`

2. **Extract Required Fields** from the sound page HTML:
   - **`freesoundId`**: Numeric ID (e.g. `442211`).
   - **`username`**: Uploader's username (e.g. `kangaroovindaloo`).
   - **`originalTitle`**: Original filename/title from the `<h1>` tag (e.g. `Slow Moving Steam Train Onboard Clickety Clack.wav`).
   - **`license`**: Map the Creative Commons URL to an SPDX identifier:
     | CC URL pattern | SPDX |
     |---|---|
     | `creativecommons.org/publicdomain/zero/1.0` | `CC0-1.0` |
     | `creativecommons.org/licenses/by/4.0` | `CC-BY-4.0` |
     | `creativecommons.org/licenses/by/3.0` | `CC-BY-3.0` |
     | `creativecommons.org/licenses/by-nc/4.0` | `CC-BY-NC-4.0` |
   - **`previewPath`**: HQ MP3 preview URL path. The prefix directory is the **first 3 digits** of the freesoundId:
     `previews/<first3digits>/<freesoundId>_<uploaderId>-hq.mp3`
     *(Example: ID `442211` → prefix `442` → `previews/442/442211_1728127-hq.mp3`)*
   - **`pageUrl`**: Full URL to the sound page.

---

## 3. Configuring `config/sounds.json`

Append the new sound entry to `config/sounds.json` (a JSON array). Place it near related entries (e.g. next to other transport sounds).

### Example Entry:

```json
{
  "id": "train_steam_clickety",
  "title": "Slow moving steam train",
  "category": "transport",
  "tags": ["train", "steam", "passenger-train", "rail-road", "transport", "ambient", "freesound"],
  "freesoundId": 442211,
  "username": "kangaroovindaloo",
  "originalTitle": "Slow Moving Steam Train Onboard Clickety Clack.wav",
  "license": "CC-BY-4.0",
  "previewPath": "previews/442/442211_1728127-hq.mp3",
  "pageUrl": "https://freesound.org/people/kangaroovindaloo/sounds/442211/",
  "maxSec": 60,
  "crossfadeMs": 120
}
```

### Required Properties:

| Property | Type | Description |
|---|---|---|
| `id` | string | Unique `snake_case` identifier (convention: `<category>_<descriptor>`) |
| `title` | string | Human-readable display title |
| `category` | string | Sound category: `rain`, `thunder`, `ocean`, `water`, `stream`, `waterfall`, `cave`, `wind`, `forest`, `birds`, `insects`, `frogs`, `fire`, `transport` |
| `tags` | string[] | Descriptive tags; always include `"ambient"` and `"freesound"` |
| `freesoundId` | number | Freesound numeric sound ID |
| `username` | string | Freesound uploader username |
| `originalTitle` | string | Original sound title/filename on Freesound |
| `license` | string | SPDX license identifier (see table above) |
| `previewPath` | string | CDN-relative path to HQ MP3 preview |
| `pageUrl` | string | Full Freesound sound page URL |
| `maxSec` | number | Trim length in seconds (default `60`, some use `90`) |
| `crossfadeMs` | number | Crossfade duration in ms for looping (typically `80`–`150`) |

### Optional Properties:

| Property | Type | Default | Description |
|---|---|---|---|
| `loopMode` | string | `"crossfade"` | Set to `"native"` for sounds designed for seamless looping |

---

## 4. License Compatibility

> [!IMPORTANT]
> If the sound uses a license not already in the `ALLOWED` set in `scripts/validate-manifests.mjs`, you **must** add it there. Also ensure the license URL is mapped in the `LICENSE_URLS` object in `scripts/fetch-freesound-core.mjs`.

Current allowed licenses (in `validate-manifests.mjs` line 12):
```js
const ALLOWED = new Set(['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'CC-BY-NC-4.0', 'PD']);
```

Current license URL mappings (in `fetch-freesound-core.mjs`):
```js
const LICENSE_URLS = {
  'CC0-1.0': 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY-4.0': 'https://creativecommons.org/licenses/by/4.0/',
  'CC-BY-3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY-NC-4.0': 'https://creativecommons.org/licenses/by-nc/4.0/',
};
```

---

## 5. Preventing Re-encoding of Existing Sounds

> [!IMPORTANT]
> The fetch script `scripts/fetch-freesound-core.mjs` checks `if (!existsSync(ogg) || process.argv.includes('--force'))` before running `ffmpeg`.

- **Default behaviour:** Only **missing** `.ogg` audio files are downloaded and encoded. Pre-existing `.ogg` binary files are skipped and remain unchanged in Git.
- **Forced re-encoding:** Pass `--force` only if source audio parameters (e.g. `maxSec`) change and a full re-encode is intended:
  ```bash
  node scripts/fetch-freesound-core.mjs --force
  ```

> [!WARNING]
> The fetch script also performs **orphan cleanup**: it deletes any `.ogg` file in `public/sounds/core/` that does not correspond to an entry in `config/sounds.json`. Never accidentally remove entries from `sounds.json` without intending to delete the audio file.

---

## 6. Import & Validation Pipeline

Execute the following commands in sequence:

### Step 1 — Fetch and Package Audio:
```bash
node scripts/fetch-freesound-core.mjs
```
This script:
- Downloads master HQ MP3 previews into `assets-masters/freesound/` (cached; skips existing)
- Encodes new OGG Vorbis files into `public/sounds/core/` (skips existing unless `--force`)
- Writes `public/sounds/catalog.json`
- Writes `ATTRIBUTIONS.md`
- Deletes orphan `.ogg` files not in `sounds.json`

Equivalent npm script: `pnpm sounds:freesound`

### Step 2 — Validate Manifests:
```bash
node scripts/validate-manifests.mjs
```
Validates:
- Catalog structure, unique IDs, license types, `.ogg` file presence
- `config/sounds.json` is a valid JSON array
- `config/default-presets.json` presets only reference valid asset IDs from the catalog

Equivalent npm script: `pnpm validate-manifests`

### Step 3 — Verify Build:
```bash
npm run build
```

### Step 4 — Verify Git Working Tree:
```bash
git status --short
```
Confirm that **only** new `.ogg` files appear as untracked, and only metadata files (`catalog.json`, `ATTRIBUTIONS.md`, `sounds.json`) are modified. No pre-existing `.ogg` files should be touched.

---

## 7. Related Scripts (Do Not Confuse)

| Script | Purpose |
|---|---|
| `scripts/fetch-freesound-core.mjs` | **This is the Freesound import script.** Downloads, encodes, and catalogs Freesound sounds. |
| `scripts/generate-core-pack.mjs` | Generates procedural placeholder sounds (rain, ocean, wind, fire, stream). **Not used for Freesound imports.** |
| `scripts/validate-manifests.mjs` | Validates catalog, config, and presets integrity. |
