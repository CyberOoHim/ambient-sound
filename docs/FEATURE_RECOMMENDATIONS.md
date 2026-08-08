# Feature Enhancement & Enrichment Recommendations

Ideation and status for **Ambient Sound**. **Assignment of work lives in [PROJECT_STATUS.md](../PROJECT_STATUS.md)** — use item IDs there.

**Status legend:** Done · Partial · Open (Phase 4) · Deferred

---

## Shipped

| Feature | Phase | Notes |
| :--- | :---: | :--- |
| Noise + sample mixer, mute/solo/pan | 0 | Web Audio graph, master fade |
| Sleep timer | 0 | Wall-clock, visibility resync |
| PWA (SW + manifest, offline audio) | 0 | Range support for iOS |
| Mobile background audio + Media Session | 0–2 | Artwork; next/prev cycles presets |
| Binaural / isochronic tones | 0 | Delta–gamma + custom |
| Stochastic one-shot events | 0–2 | Packs, custom packs; dedicated `event_*` clips |
| Scene-aware presets | 1 | Layers + timer + binaural + one-shot |
| URL hash shareable presets | 1 | `#mix=<base64url>` + **Copy link** |
| In-app attributions + system fonts | 1 | Offline-first |
| PR CI | 1 | check / test / build |
| Per-layer LP / HP filters | 2 | Preset/share persist |
| Pomodoro work/break | 2 | Timer panel |
| Surprise me | 2 | 2–4 complementary layers |
| Library search, layer cap, mobile UX | 2 | Collapsible panels, first-run tip |
| Generative visualizer | 3 | Analyser + canvas; reduced-motion |
| Dynamic mood themes | 3 | `data-mood` from active layers |
| Local audio import (IndexedDB) | 3 | Drag-drop / file pick; `local:` layers |
| 2D spatial sound canvas | 3 | X=pan, Y=volume; optional distance LP |
| Auto-panning LFO | 3 | Per-layer rate + depth |

---

## 1. Audio engine & DSP

### 1.1–1.2 Binaural · spatial canvas · auto-pan — **Done**

### 1.3 Per-layer LP/HP — **Done (Phase 2)**

### 1.4 Stochastic one-shots + dedicated event clips — **Done (Phase 0–2)**

### 1.5 Global EQ / light reverb (master bus) — **Done (Phase 4 · ENH-17)**

Bass/treble shelves + light convolver reverb on the master bus; ⚙ Mix settings; preset/share.

### 1.6 Preset crossfade on load — **Done (Phase 4 · ENH-18)**

~0.4s master fade when swapping presets / shared scenes while playing.

---

## 2. Focus & productivity

### 2.1 Pomodoro — **Done (Phase 2)**

### 2.2 Curated activity presets — **Partial**

Shipped defaults include Deep Sleep Focus, Night Forest, Deep Focus, Cozy Rainy Cafe, Storm Night, Train Focus, etc.

- **CNT-01** (Phase 4, deferred): more scenes that use spatial + LFO.
- **CNT-02 / CNT-03** (Phase 4, deferred): more `event_*` clips and optional core loops.

### 2.3 Surprise me — **Done (Phase 2)**

---

## 3. Visuals & UI

### 3.1 Visualizer · 3.2 Mood themes — **Done (Phase 3)**

---

## 4. Customization & sharing

### 4.1 URL hash share — **Done (Phase 1)** · polish **Done (Phase 4 · POL-02)**

Compact payloads, open toast, OG meta for link previews where host allows.

### 4.2 Local import — **Done (Phase 3)** · durability **Done (Phase 4 · ENH-16)**

Backup/export of IndexedDB clips, quota messaging, remove unused.

---

## 5. PWA & mobile

### 5.1 PWA · 5.2 Media Session art + next/prev — **Done**

### 5.3 Offline integrity — **Done (Phase 1–2)**

System fonts; SW `CACHE_VERSION` stamped per build.

---

## Phase 4 summary (see PROJECT_STATUS.md)

| ID | Title | Status |
| :--- | :--- | :--- |
| POL-01 | Full QA pass (Phase 3 focus) | **Done** (`0.2.1`) |
| DOC-01 | Resync this file with project plan | **Done** |
| CNT-01 | Expand default scene presets | **Deferred** (content later) |
| CNT-02 | Grow one-shot event library | **Deferred** (content later) |
| CNT-03 | Optional new core loops | **Deferred** (content later) |
| POL-02 | Share-link discovery polish | **Done** |
| ENH-16 | Local-import backup & storage UX | **Done** |
| ENH-17 | Global EQ / light reverb bus | **Done** |
| ENH-18 | Preset crossfade on load | **Done** |

**Product scope:** web / PWA only. No desktop shell track.

---

## Prioritization matrix

| Feature | Effort | Impact | Status |
| :--- | :---: | :---: | :--- |
| Scene presets + share + attributions + CI | Low–Med | High | **Done** |
| Filters, Pomodoro, Surprise, Media Session | Med | High | **Done** |
| Visualizer, mood, spatial, LFO, local import | High | High | **Done** |
| QA + docs · share polish · local backup | Low–Med | High | **Done** |
| Master EQ/reverb · preset crossfade | Med–High | Med | **Done** |
| Content depth (presets / events / cores) | Low–Med | High | **Deferred** |
