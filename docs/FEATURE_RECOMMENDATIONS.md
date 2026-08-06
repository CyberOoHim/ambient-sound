# Feature Enhancement & Enrichment Recommendations

This document outlines proposed feature enhancements and enrichment ideas for **Ambient Sound**, categorized by domain, user experience impact, and technical implementation scope.

---

## 1. 🎵 Audio Engine & DSP Enhancements

### 1.1 Binaural Beats & Isochronic Tone Generator
- **Concept:** Synthesize carrier sine waves with adjustable stereo frequency offsets to produce binaural beats across standard brainwave states:
  - **Delta (1–4 Hz):** Deep sleep and restoration
  - **Theta (4–8 Hz):** Meditation, REM sleep, and creativity
  - **Alpha (8–13 Hz):** Relaxed focus and stress reduction
  - **Beta (13–30 Hz):** Active concentration and problem solving
- **Implementation Note:** Can be built as a procedural audio node within [`src/audio/engine.ts`](file:///c:/Users/marti/Projects/tools/ambient-sound/src/audio/engine.ts) alongside existing procedural noise generators.

### 1.2 Dynamic Spatial Panning & 2D Sound Canvas
- **Concept:** Introduce dynamic audio positioning per layer:
  - **Auto-Panning:** Web Audio `StereoPannerNode` with low-frequency oscillators (LFOs) to gently move sounds (e.g. ocean waves, wind) across the soundstage.
  - **2D Sound Canvas UI:** A spatial positioning grid where sound icons can be dragged closer to the center for volume and left/right for stereo panning.

### 1.3 Per-Layer Audio Filters (Indoor vs. Outdoor Effects)
- **Concept:** Add customizable Low-Pass and High-Pass `BiquadFilterNode` controls to individual audio layers.
- **Use Case:** Muffling a rain track to create an "indoor/window rain" effect, or brightening wind and procedural noise tracks.

### 1.4 Organic Random One-Shot Audio Events
- **Concept:** A background event scheduler that triggers occasional non-looping audio clips (e.g., distant thunderclaps, randomized bird calls, rustling leaves, or train whistles) to break ambient loop monotony and closely mimic the unpredictable acoustic rhythm of real-world environments.

#### Key Design & Realism Mechanics
1. **Stochastic Timing (Poisson Process / Exponential Jitter)**
   - Replaces fixed metronomic timers with variable time distributions based on a Poisson process.
   - Prevents predictable intervals so the human ear cannot anticipate when an event will occur.

2. **Acoustic Micro-Variations (Per-Trigger Randomization)**
   - **Dynamic Pitch Jitter:** Randomly alters playback rate/pitch by ±5–10% on every trigger so repeated samples (e.g., bird chirps) sound naturally distinct.
   - **Spatial Stereo Panning:** Randomizes left/right positioning across the soundstage using `StereoPannerNode` to simulate distant events coming from different directions.
   - **Distance & Atmosphere Simulation:** Pairs gain attenuation with a dynamic `BiquadFilterNode` (low-pass filter). Farther events sound quieter and muffier; nearer events sound louder and brighter.
   - **Acoustic Tail / Wet Reverb:** Adjusts decay and wet mix for reverberant events like thunder or foghorns.

3. **Natural Burst & Call-Response Patterns**
   - **Call Sequences:** Simulates realistic animal behavior (e.g. a bird calling 2–4 times in rapid succession with 200–500ms micro-pauses before falling silent).
   - **Multi-Phase Events:** Simulates rolling thunder strikes composed of an initial sharp crack followed by low-frequency rumbling echoes.

4. **Categorized Sound Packs**
   - 🌩️ **Storm & Sky:** Low distant thunder, sharp lightning cracks, sudden wind gusts.
   - 🌲 **Wild Forest:** Woodland songbirds, night owl hoots, branch snaps, rustling canopy leaves.
   - 🌊 **Coastal & Ocean:** Distant seagull cries, rogue crashing wave accents, ship foghorns.
   - ☕ **Cozy & Urban:** Distant train whistles, grandfather clock chimes, rain window strikes, fireplace pops.

5. **User-Configurable Density & Controls**
   - **Sparse / Subtle:** Triggers every 3–8 minutes (ideal for deep focus).
   - **Natural / Balanced:** Triggers every 1–3 minutes (default ambiance).
   - **Lively / Dynamic:** Triggers every 15–45 seconds (rich, interactive feel).
   - **Per-Event Frequency Weighting:** Allows users to toggle or weight specific sound triggers within active themes.

6. **Technical Implementation Strategy**
   - Built as an `EventScheduler` module in the Web Audio graph (`src/audio/engine.ts`).
   - Uses light, pre-decoded `AudioBuffer` assets loaded into memory.
   - Instantiates a short-lived node pipeline for each trigger:
     `AudioBufferSourceNode` ➔ `BiquadFilterNode` ➔ `StereoPannerNode` ➔ `GainNode` ➔ `Destination`.

---

## 2. ⏱️ Focus & Productivity Integration

### 2.1 Pomodoro & Work/Break Cycle Integration
- **Concept:** Expand [`TimerPanel.svelte`](file:///c:/Users/marti/Projects/tools/ambient-sound/src/ui/TimerPanel.svelte) to support Pomodoro work/break intervals (e.g., 25m focus / 5m rest).
- **Smart Preset Switch:** Automatically dim ambient audio or transition to a relaxing soundscape (e.g. gentle stream/birds) when work cycles complete.

### 2.2 Curated Activity Presets
- **Concept:** Pre-load theme presets in [`PresetsPanel.svelte`](file:///c:/Users/marti/Projects/tools/ambient-sound/src/ui/PresetsPanel.svelte) tailored for specific activities:
  - 🌧️ **Cozy Rainy Cafe:** Rain + Fireplace + Coffee Shop/Train
  - 🌲 **Night Forest:** Wind + Crickets + Campfire + Frogs
  - 🧠 **Deep Focus:** Pink Noise + Ocean Waves + Alpha Binaural Tones

### 2.3 Soundscape Randomizer ("Surprise Me")
- **Concept:** A single-click generator that selects 2–4 complementary audio layers at randomized, balanced gain levels for spontaneous discovery.

---

## 3. 🎨 Visuals & UI/UX Immersion

### 3.1 Generative Canvas / WebGL Visualizer
- **Concept:** Add a lightweight, interactive audio visualizer linked to the Web Audio `AnalyserNode`:
  - Particle rain drops reacting to rain audio frequency.
  - Floating warm embers reacting to campfire audio.
  - Ambient fluid gradient wave visualizer.

### 3.2 Dynamic Mood Themes
- **Concept:** Dynamically transition the CSS color palette based on active soundscapes (e.g., deep slate blue for rain, warm amber glow for fireplace, emerald green for forest).

---

## 4. 📁 Customization & Sharing

### 4.1 URL Hash Shareable Presets
- **Concept:** Encode preset mix configurations (active tracks, volume gains, filter states) into a compressed URL hash string (e.g. `https://.../#mix=eJy...`).
- **Benefit:** Enables instant, zero-backend preset sharing via simple web links.

### 4.2 Local Custom Audio File Import (IndexedDB)
- **Concept:** Allow users to drag and drop custom `.mp3`, `.wav`, or `.ogg` field recordings into the mixer.
- **Storage:** Persist imported files locally using IndexedDB for seamless offline availability.

---

## 5. 📱 PWA & Mobile Enhancements

### 5.1 Service Worker & PWA Support
- **Concept:** Add a Web App Manifest (`manifest.json`) and a Service Worker for offline asset caching.
- **Benefit:** Allows users to install Ambient Sound directly to desktop/mobile home screens with 100% offline playback capabilities.

### 5.2 Rich Lock Screen & Smartwatch Media Controls
- **Concept:** Expand Media Session API integration ([`media-session.ts`](file:///c:/Users/marti/Projects/tools/ambient-sound/src/audio/media-session.ts)) to map Next/Previous hardware media controls to preset switching, displaying custom artwork on OS lock screens.

---

## Summary Prioritization Matrix

| Feature | Effort | Impact | Recommended Priority |
| :--- | :---: | :---: | :---: |
| **URL Hash Shareable Presets** | Low | High | Phase 1 |
| **PWA Service Worker & Manifest** | Low | High | Phase 1 |
| **Binaural Beats Generator** | Medium | High | Phase 1 |
| **Curated Activity Presets** | Low | Medium | Phase 1 |
| **Per-Layer Filter Controls** | Medium | Medium | Phase 2 |
| **Pomodoro Timer Integration** | Medium | High | Phase 2 |
| **Generative Visualizer / Canvas** | High | High | Phase 2 |
| **Local Audio Upload (IndexedDB)** | High | Medium | Phase 3 |
| **2D Spatial Sound Canvas** | High | High | Phase 3 |
