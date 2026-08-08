# Ambient Sound — Project Status & Work Plan

| Field | Value |
|-------|--------|
| **Last updated** | 2026-08-08 |
| **Branch** | `main` |
| **Latest related work** | Phase 4 polish shipped (QA, docs, share, local backup, EQ/reverb, crossfade) · app `0.2.1` · content (CNT-*) deferred |
| **Product scope** | Web / PWA only |
| **How to use this file** | Assign work by **phase** or by **item ID**. Check off items when done; move them to [Done](#done--shipped). |

**Status values:** `done` · `open` · `partial` · `blocked`

---

## Quick assign index

| ID | Title | Phase | Effort | Impact | Status |
|----|--------|-------|--------|--------|--------|
| FIX-01 … FIX-08 | Phase 2 fixes | 2 | — | — | **done** |
| ENH-01 … ENH-10 | Phase 2 enhancements | 2 | — | — | **done** |
| ENH-11 … ENH-15 | Phase 3 features | 3 | — | — | **done** |
| POL-01 | Full QA pass (esp. Phase 3) | 4 | Low | High | **done** |
| DOC-01 | Resync FEATURE_RECOMMENDATIONS | 4 | Low | Low | **done** |
| CNT-01 | Expand default scene presets | 4 | Low | High | **open** (deferred) |
| CNT-02 | Grow one-shot event library | 4 | Medium | High | **open** (deferred) |
| CNT-03 | Optional new core loops | 4 | Medium | Medium | **open** (deferred) |
| POL-02 | Share-link discovery polish | 4 | Medium | Medium | **done** |
| ENH-16 | Local-import backup / quota UX | 4 | Medium | Medium | **done** |
| ENH-17 | Global EQ / light reverb bus | 4 | High | Medium | **done** |
| ENH-18 | Preset crossfade on load | 4 | Medium | Medium | **done** |

**Phases 0–3 shipped.** Phase 4 **polish** shipped in `0.2.1`. Remaining Phase 4 work is **content only** (CNT-01…03). Desktop / Tauri remains out of scope.

**Next default assign:** Bundle I — content depth (`CNT-01` · `CNT-02` · optional `CNT-03`).

---

## How to assign work

Pick one of:

1. **Whole phase** — e.g. “Do all of Phase 4”
2. **Single item** — e.g. “Do CNT-01”
3. **Bundle** — e.g. “Do Bundle I (content depth)”

When finishing an item, update its **Status** to `done` and add a one-line note under [Done — shipped](#done--shipped).

---

## Done — shipped

### Phase 0 — Core product (pre-review baseline)

| Area | Notes |
|------|--------|
| Noise + sample mixer | Web Audio graph, mute/solo/pan, master fade |
| Sleep timer | Wall-clock, visibility resync |
| PWA | Manifest + SW, offline audio cache, Range for iOS |
| Mobile background audio | Media element path + Media Session play/pause |
| Binaural / isochronic | Engine + panel + localStorage |
| Stochastic one-shots | Poisson timing, packs, custom packs |
| Presets (mixer-only, originally) | Save/load/export JSON + last session |
| Tests / deploy | Vitest, validate-manifests, GitHub Pages deploy |

### Phase 1 — shipped 2026-08-07 (`8eb1e81`)

| ID | Title | Notes |
|----|--------|--------|
| P1-01 | Scene-aware presets | Layers + timer + binaural + one-shot in save/load/last-session |
| P1-02 | URL hash share | `#mix=<base64url>`, **Copy link** in Presets |
| P1-03 | System fonts only | Removed Google Fonts (offline-first) |
| P1-04 | In-app attributions | Footer modal; `#attributions` |
| P1-05 | PR CI | `.github/workflows/ci.yml` |
| P1-06 | Docs refresh | `FEATURE_RECOMMENDATIONS.md`, README presets section |
| P1-07 | Curated scene defaults | Deep Sleep Focus, Night Forest, Deep Focus in `default-presets.json` |

### Phase 2 — shipped 2026-08-07 (web `0.1.0`)

| ID | Title | Notes |
|----|--------|--------|
| FIX-01 | Enable while paused | “Starts with Play” on binaural / one-shot when paused |
| FIX-02 | SW cache version | Vite plugin stamps `CACHE_VERSION` from package version + build time |
| FIX-03 | One-shot slices | Tighter durations; per-asset `oneShot` meta in catalog |
| FIX-04 | Layer limit | Soft cap `MAX_MIXER_LAYERS` (10) with notice |
| FIX-05 / ENH-06 | Media Session | Artwork + next/previous → cycle presets |
| FIX-06 | Destructive confirms | Clear all + preset overwrite confirm |
| FIX-07 | Min-offset UX | Moved to mixer ⚙ settings (out of Presets) |
| FIX-08 | Version / QA | `package.json` → `0.1.0`; `docs/qa-checklist.md` (web-only DoD) |
| ENH-01 | One-shot sample pack | `public/sounds/events/*` short clips + pack prefers event_* ids |
| ENH-02 | Per-layer LP/HP | User filters on noise + samples; preset/share persist |
| ENH-03 | Pomodoro | Work/break cycles in Timer panel |
| ENH-04 | Surprise me | Library button → 2–4 complementary layers |
| ENH-05 | More presets | Cozy Rainy Cafe, Storm Night, Train Focus + Restore defaults |
| ENH-07 | Library search | Search title/tags; layer count / near-cap warn |
| ENH-08 | First-run tip | Dismissible mobile Play tip |
| ENH-09 | Collapsible panels | Accordion side stack on narrow viewports |
| ENH-10 | One-shot fire toast | Brief chip when an event fires |

**Scripts:** `pnpm sounds:events` extracts event clips (ffmpeg).

### Phase 3 — shipped 2026-08-08 (web `0.2.0`)

| ID | Title | Notes |
|----|--------|--------|
| ENH-11 | Generative visualizer | `Visualizer.svelte` canvas spectrum + particles + waveform; master `AnalyserNode`; respects `prefers-reduced-motion` |
| ENH-12 | Dynamic mood themes | `mood-theme.ts` + `data-mood` CSS palettes (rain/fire/forest/ocean/night/train/cave) from active layers |
| ENH-13 | Local audio import | IndexedDB store; drag-drop / file pick in Library; `local:` sample layers offline |
| ENH-14 | 2D spatial canvas | `SpatialCanvas.svelte` — X=pan, Y=volume/distance; optional LP distance coupling |
| ENH-15 | Auto-panning LFO | Per-layer rate/depth; sine LFO into `StereoPannerNode.pan`; preset/share persist |

**Primary files:** `src/ui/Visualizer.svelte`, `src/ui/SpatialCanvas.svelte`, `src/ui/mood-theme.ts`, `src/audio/local-audio-store.ts`, `src/audio/engine.ts`, `src/audio/types.ts`, `src/app/session.ts`, `src/app.css`

### Phase 4 polish — shipped 2026-08-08 (web `0.2.1`)

| ID | Title | Notes |
|----|--------|--------|
| POL-01 | Full QA pass | Expanded `docs/qa-checklist.md` for Phase 3–4; automated suite green (`check` / `test` / `build` / manifests) |
| DOC-01 | Resync FEATURE_RECOMMENDATIONS | Aligned with shipped Phase 2–3 + Phase 4 IDs |
| POL-02 | Share-link polish | Compact hash encode (drop defaults); OG/meta in `index.html`; open-toast auto-dismiss; copy-link length hint |
| ENH-16 | Local-import backup & storage UX | Export/import JSON backup; storage usage line; remove unused; clearer quota errors |
| ENH-17 | Global EQ / light reverb | Master bass/treble shelves + synthetic convolver wet; ⚙ Mix settings; preset/share/last-session |
| ENH-18 | Preset crossfade | ~0.4s fade out → swap → fade in when loading preset / shared scene while playing |

**Primary files:** `src/audio/engine.ts`, `src/audio/types.ts`, `src/audio/local-audio-store.ts`, `src/app/session.ts`, `src/app/presets.ts`, `src/app/share.ts`, `src/ui/Mixer.svelte`, `src/ui/LibraryPanel.svelte`, `src/ui/PresetsPanel.svelte`, `index.html`, `docs/*`

---

## Phase 4 — remaining content (deferred)

Asset / catalog expansion deliberately left open. Prefer Freesound import skill + existing scripts when ready.

### CNT-01 — Expand default scene presets

| | |
|--|--|
| **Status** | **open** (deferred) |
| **Effort** | Low |
| **Impact** | High |
| **Area** | Content |

**Work:** Add **3–5** curated presets in `config/default-presets.json` that exercise Phase 3–4 controls (spatial, LFO, master tone, filters, one-shots).

**Primary files:** `config/default-presets.json`

---

### CNT-02 — Grow one-shot event library

| | |
|--|--|
| **Status** | **open** (deferred) |
| **Effort** | Medium |
| **Impact** | High |
| **Area** | Content |

**Work:** Grow beyond ~8 clips under `public/sounds/events/`. Target **+4–8** short events. Use Freesound skill / `pnpm sounds:events` / `validate-manifests`.

**Primary files:** `public/sounds/events/*`, catalog, attributions

---

### CNT-03 — Optional new core loops

| | |
|--|--|
| **Status** | **done** (Waves A–C shipped) |
| **Effort** | Medium–High |
| **Impact** | High |
| **Area** | Content |

**Work:** Diversify the core pack beyond nature/transport. Full plan: [docs/plan-core-loop-expansion.md](docs/plan-core-loop-expansion.md).

- **Wave A (+6):** ✅ `cafe_murmur`, `library_quiet`, `city_soft`, `rain_window`, `rain_heavy`, `fireplace_indoor`  
- **Wave B (+6):** ✅ `river_wide`, `creek_rocks`, `fountain_plaza`, `snow_wind`, `meadow_day`, `ac_room`  
- **Wave C (+5):** ✅ `park_city`, `metro_cabin`, `rain_leaves`, `temple_soft`, `harbor_night` (skipped redundant woodstove)  
- **Totals:** **54 cores**, Indoor/Urban groups, mood scoring, expanded default presets  

**Primary files:** `config/sounds.json`, `public/sounds/core/*`, catalog, attributions, `LibraryPanel.svelte`, freesound skill

---

## Phase 4 polish detail (shipped reference)

### POL-01 — Full QA pass — **done**

Automated gate green; checklist updated for Phase 3–4 manual paths. Full manual/device matrix still recommended before a marketing release.

### DOC-01 — Resync FEATURE_RECOMMENDATIONS — **done**

### POL-02 — Share-link discovery polish — **done**

Compact layer/master encoding; OG description tags; share toast; copy feedback with long-URL warning.

### ENH-16 — Local-import backup & storage UX — **done**

Library: Export / Import backup, Remove unused, storage estimate line, quota-friendly import errors.

### ENH-17 — Global EQ / light reverb — **done**

Graph: layers → mixBus → bass → treble → dry/wet reverb → masterGain → analyser. Controls in ⚙ Mix settings.

### ENH-18 — Preset crossfade — **done**

`PRESET_CROSSFADE_SEC` (~0.4s) on `loadPreset` / `applySharedScene` when already playing.

---

## Suggested assignment bundles

### Bundle F — “Immersion” (Phase 3) — **shipped**

`ENH-11` · `ENH-12` · `ENH-15`

### Bundle G — “Custom audio” (Phase 3) — **shipped**

`ENH-13`

### Bundle H — “Spatial” (Phase 3) — **shipped**

`ENH-14` · `ENH-15`

### Bundle I — “Content depth” (Phase 4) — **open** *(next product work)*

`CNT-01` · `CNT-02` · optional `CNT-03`

### Bundle J — “Ship confidence” (Phase 4) — **shipped**

`POL-01` · `DOC-01`

### Bundle K — “Share & custom durability” (Phase 4) — **shipped**

`POL-02` · `ENH-16`

### Bundle L — “Mix glue” (Phase 4) — **shipped**

`ENH-17` · `ENH-18`

---

## Phase 3 detail (shipped reference)

### ENH-11 — Generative visualizer

| | |
|--|--|
| **Status** | **done** |
| **Effort** | High |
| **Impact** | High |
| **Area** | Visuals |

**Work:** Lightweight canvas tied to `AnalyserNode` (already on master bus). Respect `prefers-reduced-motion`.

**Primary files:** `src/ui/Visualizer.svelte`, `src/audio/engine.ts` (analyser access)

---

### ENH-12 — Dynamic mood themes

| | |
|--|--|
| **Status** | **done** |
| **Effort** | Medium |
| **Impact** | Medium |
| **Area** | UI |

**Work:** Shift CSS palette from active layers (rain → slate blue, fire → amber, forest → green).

**Primary files:** `src/app.css`, `src/ui/mood-theme.ts`, `src/ui/Mixer.svelte`

---

### ENH-13 — Local audio import (IndexedDB)

| | |
|--|--|
| **Status** | **done** |
| **Effort** | High |
| **Impact** | Medium |
| **Area** | Customization |

**Work:** Drag-drop `.mp3`/`.wav`/`.ogg`; persist in IndexedDB; appear as sample layers offline.

**Primary files:** `src/audio/local-audio-store.ts`, `src/ui/LibraryPanel.svelte`, `src/app/session.ts`, `src/audio/engine.ts`

---

### ENH-14 — 2D spatial sound canvas

| | |
|--|--|
| **Status** | **done** |
| **Effort** | High |
| **Impact** | High |
| **Area** | Audio / UI |

**Work:** Drag icons for pan (X) and distance/gain (Y); optional coupling with filters.

**Primary files:** `src/ui/SpatialCanvas.svelte`, `src/app/session.ts` (`setLayerSpatial`)

---

### ENH-15 — Auto-panning LFO

| | |
|--|--|
| **Status** | **done** |
| **Effort** | Medium |
| **Impact** | Medium |
| **Area** | Audio |

**Work:** Optional slow LFO on layer pan for ocean/wind motion; rate + depth controls.

**Primary files:** `src/audio/engine.ts`, `src/audio/types.ts`, `src/ui/Mixer.svelte`

---

## Verification checklist (any phase)

Before merging assigned work:

```bash
pnpm install
pnpm validate-manifests
pnpm check
pnpm test
pnpm build
```

Manual smoke (web):

1. Play / pause (Space)
2. Add sample while playing (download progress)
3. Sleep timer fade + cancel
4. Load scene preset (tones + events)
5. Copy link → open in new tab
6. Attributions modal
7. (Mobile) lock screen continues audio after Play once
8. Surprise me / Pomodoro / LP-HP filters (Phase 2)
9. Visualizer animates while playing; reduced-motion → static wash
10. Mood palette shifts with rain / fire / forest layers
11. Space canvas drag updates pan + volume
12. Auto-pan LFO on a layer
13. Import local mp3/wav/ogg → add to mix → survives reload
14. Master tone (bass / treble / space) via ⚙; survives reload
15. Load preset while playing → short crossfade
16. Local Export / Import backup; Remove unused
17. (When content ships) New default presets + `event_*` one-shots validate cleanly

See also [docs/qa-checklist.md](docs/qa-checklist.md).

---

## Related docs

| Doc | Role |
|-----|------|
| [README.md](README.md) | User-facing features & scripts |
| [docs/FEATURE_RECOMMENDATIONS.md](docs/FEATURE_RECOMMENDATIONS.md) | Feature ideation (synced via DOC-01) |
| [docs/design-ambient-sound-app.md](docs/design-ambient-sound-app.md) | Architecture & original DoD |
| [docs/qa-checklist.md](docs/qa-checklist.md) | Web QA / release checklist (0.2.x) |
| [docs/FREESOUND_IMPORT_GUIDE.md](docs/FREESOUND_IMPORT_GUIDE.md) | Asset pipeline |
| [.agents/skills/freesound-import/SKILL.md](.agents/skills/freesound-import/SKILL.md) | Agent skill for Freesound import |

---

## Changelog for this plan

| Date | Change |
|------|--------|
| 2026-08-07 | Initial `PROJECT_STATUS.md` from full-app review + Phase 1 completion |
| 2026-08-07 | Phase 2 complete: all FIX-01…08 + ENH-01…10; version 0.1.0 |
| 2026-08-08 | Phase 3 complete: ENH-11…15; version 0.2.0 |
| 2026-08-08 | Dropped Tauri / desktop architecture track (ARCH-01…03); product is web/PWA only |
| 2026-08-08 | Phase 4 opened: content depth (CNT-01…03), QA/docs (POL-01, DOC-01), share & local durability (POL-02, ENH-16), optional mix glue (ENH-17, ENH-18); Bundles I–L |
| 2026-08-08 | Phase 4 polish shipped: POL-01, DOC-01, POL-02, ENH-16…18; version 0.2.1; CNT-01…03 remain deferred |
