# Ambient Sound — Project Status & Work Plan

| Field | Value |
|-------|--------|
| **Last updated** | 2026-08-07 |
| **Branch** | `main` |
| **Latest related work** | Phase 2 complete (fixes + enhancements) · app `0.1.0` |
| **How to use this file** | Assign work by **phase** (`Phase 3`) or by **item ID**. Check off items when done; move them to [Done](#done--shipped). |

**Status values:** `done` · `open` · `partial` · `blocked`

---

## Quick assign index

| ID | Title | Phase | Effort | Impact | Status |
|----|--------|-------|--------|--------|--------|
| FIX-01 … FIX-08 | Phase 2 fixes | 2 | — | — | **done** |
| ENH-01 … ENH-10 | Phase 2 enhancements | 2 | — | — | **done** |
| [ENH-11](#enh-11--generative-visualizer) | Generative visualizer | 3 | High | High | open |
| [ENH-12](#enh-12--dynamic-mood-themes) | Dynamic mood themes | 3 | Med | Med | open |
| [ENH-13](#enh-13--local-audio-import-indexeddb) | Local audio import (IndexedDB) | 3 | High | Med | open |
| [ENH-14](#enh-14--2d-spatial-sound-canvas) | 2D spatial sound canvas | 3 | High | High | open |
| [ENH-15](#enh-15--auto-panning-lfo) | Auto-panning LFO | 3 | Med | Med | open |
| [ARCH-01](#arch-01--tauri-desktop-shell) | Tauri desktop shell | later | High | Med | open |
| [ARCH-02](#arch-02--output-device-picker) | Output device picker | later | Med | Low | open |
| [ARCH-03](#arch-03--system-tray--global-hotkeys) | System tray / global hotkeys | later | Med | Med | open |

---

## How to assign work

Pick one of:

1. **Whole phase** — e.g. “Do all of Phase 3”
2. **Single item** — e.g. “Do ENH-11”
3. **Bundle** — e.g. “Do ENH-11 + ENH-12 (immersion)”

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

---

## Phase 3 — Larger features

Higher effort or lower urgency. Assign only when Phase 2 is mostly clear.

### ENH-11 — Generative visualizer

| | |
|--|--|
| **Status** | open |
| **Effort** | High |
| **Impact** | High |
| **Area** | Visuals |

**Work:** Lightweight canvas/WebGL tied to `AnalyserNode` (already on master bus). Respect `prefers-reduced-motion`.

**Primary files:** new `src/ui/Visualizer.svelte`, `src/audio/engine.ts` (analyser access)

---

### ENH-12 — Dynamic mood themes

| | |
|--|--|
| **Status** | open |
| **Effort** | Medium |
| **Impact** | Medium |
| **Area** | UI |

**Work:** Shift CSS palette from active layers (rain → slate blue, fire → amber, forest → green).

**Primary files:** `src/app.css`, `src/ui/Mixer.svelte`

---

### ENH-13 — Local audio import (IndexedDB)

| | |
|--|--|
| **Status** | open |
| **Effort** | High |
| **Impact** | Medium |
| **Area** | Customization |

**Work:** Drag-drop `.mp3`/`.wav`/`.ogg`; persist in IndexedDB; appear as sample layers offline.

**Primary files:** new import module, `src/assets/`, `src/ui/LibraryPanel.svelte`, decode path

---

### ENH-14 — 2D spatial sound canvas

| | |
|--|--|
| **Status** | open |
| **Effort** | High |
| **Impact** | High |
| **Area** | Audio / UI |

**Work:** Drag icons for pan (X) and distance/gain (Y); optional coupling with filters.

**Primary files:** new canvas component, `src/audio/engine.ts`, layer pan/gain

---

### ENH-15 — Auto-panning LFO

| | |
|--|--|
| **Status** | open |
| **Effort** | Medium |
| **Impact** | Medium |
| **Area** | Audio |

**Work:** Optional slow LFO on layer pan for ocean/wind motion; rate + depth controls.

**Primary files:** `src/audio/engine.ts`, `src/audio/types.ts`, mixer UI

---

## Later / architecture (v1.1+ design doc)

Not required for excellent web/PWA product. Assign only if desktop install is a goal.

### ARCH-01 — Tauri desktop shell

| | |
|--|--|
| **Status** | open |
| **Effort** | High |
| **Impact** | Medium |
| **Area** | Packaging |

Design KD-1: Windows-primary Tauri 2 shell. Out of web Phase 2.

---

### ARCH-02 — Output device picker

| | |
|--|--|
| **Status** | open |
| **Effort** | Medium |
| **Impact** | Low |
| **Area** | Audio |

Depends on WebView / browser `setSinkId` support.

---

### ARCH-03 — System tray / global hotkeys

| | |
|--|--|
| **Status** | open |
| **Effort** | Medium |
| **Impact** | Medium |
| **Area** | Desktop |

Requires Tauri (or similar). Deferred in design doc to v1.1.

---

## Suggested assignment bundles

### Bundle F — “Immersion” (Phase 3)

`ENH-11` · `ENH-12` · `ENH-15`

### Bundle G — “Custom audio” (Phase 3)

`ENH-13`

### Bundle H — “Spatial” (Phase 3)

`ENH-14` · `ENH-15`

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

See also [docs/qa-checklist.md](docs/qa-checklist.md).

---

## Related docs

| Doc | Role |
|-----|------|
| [README.md](README.md) | User-facing features & scripts |
| [docs/FEATURE_RECOMMENDATIONS.md](docs/FEATURE_RECOMMENDATIONS.md) | Feature ideation (synced with this plan) |
| [docs/design-ambient-sound-app.md](docs/design-ambient-sound-app.md) | Architecture & original DoD |
| [docs/qa-checklist.md](docs/qa-checklist.md) | Web 0.1.0 QA / release checklist |
| [docs/FREESOUND_IMPORT_GUIDE.md](docs/FREESOUND_IMPORT_GUIDE.md) | Asset pipeline |
| [.agents/skills/freesound-import/SKILL.md](.agents/skills/freesound-import/SKILL.md) | Agent skill for Freesound import |

---

## Changelog for this plan

| Date | Change |
|------|--------|
| 2026-08-07 | Initial `PROJECT_STATUS.md` from full-app review + Phase 1 completion |
| 2026-08-07 | Phase 2 complete: all FIX-01…08 + ENH-01…10; version 0.1.0 |
