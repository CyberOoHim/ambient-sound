# Feature Enhancement & Enrichment Recommendations

This document outlines proposed feature enhancements and enrichment ideas for **Ambient Sound**, categorized by domain, user experience impact, and technical implementation scope.

**Status legend:** Done · Phase 1 (shipped) · Proposed

---

## Shipped (keep current)

| Feature | Notes |
| :--- | :--- |
| **PWA Service Worker & Manifest** | Offline shell + audio cache; Range support for iOS |
| **Binaural Beats & Isochronic Tones** | Delta–gamma presets, custom carrier/beat, sine/triangle |
| **Stochastic One-Shot Events** | Poisson timing, packs, custom packs, acoustic micro-variations |
| **Scene-aware presets** | Layers + timer + binaural + one-shot in save/load/last-session |
| **URL hash shareable presets** | `#mix=<base64url>` + **Copy link** in Presets |
| **In-app Attributions** | Footer → modal from catalog licenses (no remote fonts) |
| **PR CI** | `.github/workflows/ci.yml` runs check/test/build on PRs |

---

## 1. Audio Engine & DSP Enhancements

### 1.1 ~~Binaural Beats & Isochronic Tone Generator~~ — **Done**

### 1.2 Dynamic Spatial Panning & 2D Sound Canvas — **Proposed**
- **Concept:** Dynamic audio positioning per layer:
  - **Auto-Panning:** `StereoPannerNode` with LFOs for gentle motion.
  - **2D Sound Canvas UI:** Drag icons for pan/distance.

### 1.3 Per-Layer Audio Filters (Indoor vs. Outdoor Effects) — **Proposed (Phase 2)**
- **Concept:** Per-layer Low-Pass / High-Pass `BiquadFilterNode` controls.
- **Use Case:** “Indoor/window rain”, brightening wind/noise.

### 1.4 ~~Organic Random One-Shot Audio Events~~ — **Done**
- Follow-up: **dedicated short event samples** (true chirps/cracks) instead of slicing long ambient loops — quality upgrade, not a new feature surface.

---

## 2. Focus & Productivity Integration

### 2.1 Pomodoro & Work/Break Cycle Integration — **Proposed (Phase 2)**
- Expand `TimerPanel.svelte` for work/break intervals with optional preset switch on break.

### 2.2 Curated Activity Presets — **Partial (Phase 1)**
- Shipped scene presets: **Deep Sleep Focus** (delta tones), **Night Forest**, **Deep Focus** (alpha).
- More activity packs can be added in `config/default-presets.json`.

### 2.3 Soundscape Randomizer ("Surprise Me") — **Proposed (Phase 2)**
- One-click 2–4 complementary layers at balanced gains.

---

## 3. Visuals & UI/UX Immersion

### 3.1 Generative Canvas / WebGL Visualizer — **Proposed (Phase 2+)**
- Lightweight `AnalyserNode` visualizer (particles, gradients).

### 3.2 Dynamic Mood Themes — **Proposed**
- CSS palette shifts from active soundscape.

---

## 4. Customization & Sharing

### 4.1 ~~URL Hash Shareable Presets~~ — **Done (Phase 1)**
- Encode scene (tracks, volumes, timer, binaural, one-shot) into `#mix=…`.
- **Copy link** on Presets panel; open link applies scene and clears hash.

### 4.2 Local Custom Audio File Import (IndexedDB) — **Proposed (Phase 3)**
- Drag-and-drop `.mp3` / `.wav` / `.ogg` with offline IndexedDB persistence.

---

## 5. PWA & Mobile Enhancements

### 5.1 ~~Service Worker & PWA Support~~ — **Done**

### 5.2 Rich Lock Screen & Smartwatch Media Controls — **Proposed (Phase 2)**
- Media Session next/previous → preset cycle; lock-screen artwork.

### 5.3 Offline integrity — **Partial (Phase 1)**
- Remote Google Fonts removed (system font stack).
- Follow-up: bump SW `CACHE_VERSION` per deploy / build hash.

---

## Summary Prioritization Matrix

| Feature | Effort | Impact | Status |
| :--- | :---: | :---: | :--- |
| **URL Hash Shareable Presets** | Low | High | **Done** |
| **Scene-aware presets** | Medium | High | **Done** |
| **PWA Service Worker & Manifest** | Low | High | **Done** |
| **Binaural Beats Generator** | Medium | High | **Done** |
| **In-app Attributions + system fonts** | Low | Medium | **Done** |
| **PR CI** | Low | High | **Done** |
| **Curated Activity Presets** | Low | Medium | **Partial** |
| **Dedicated one-shot samples** | Medium | High | Phase 2 |
| **Per-Layer Filter Controls** | Medium | Medium | Phase 2 |
| **Pomodoro Timer Integration** | Medium | High | Phase 2 |
| **Media Session next/prev + art** | Low | Medium | Phase 2 |
| **Generative Visualizer / Canvas** | High | High | Phase 2 |
| **Local Audio Upload (IndexedDB)** | High | Medium | Phase 3 |
| **2D Spatial Sound Canvas** | High | High | Phase 3 |
