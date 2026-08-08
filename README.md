# Ambient Sound

An offline-first noise and ambient sound mixer built for desktop and web.

**Live Demo:** [https://cyberoohim.github.io/ambient-sound/](https://cyberoohim.github.io/ambient-sound/)


## Features

- **Procedural Noise Generators:** Custom Web Audio API DSP noise synth (White, Pink, Brown, etc.).
- **Ambient Sample Layers:** High-quality natural field recordings (Rain, Ocean, Wind, Fire, Stream, Crickets, Birds, Thunder, Waterfall, Frogs).
- **Stochastic One-Shot Events:** Natural, non-repetitive background audio accents (bird chirps, owl hoots, distant thunder, etc.) using Poisson-process timing, pitch jitter, stereo panning, and distance low-pass filtering.
- **Spatial canvas & auto-pan:** Drag layers on a 2D space map (pan × volume); optional slow LFO auto-pan per layer.
- **Mood themes & visualizer:** Palette shifts with the mix; soft spectrum/particle canvas (respects reduced motion).
- **Local audio import:** Drop your own mp3/wav/ogg files — stored in IndexedDB on this device.
- **Sleep Timer:** Flexible duration with customizable fade-out curves (plus Pomodoro work/break cycles).
- **Custom Presets & Session Storage:** Save layer combinations and volume settings locally or export/import JSON presets; share mixes via URL hash.
- **Offline-First:** Runs entirely in the browser without remote servers or track streaming dependencies.
- **Mobile background audio:** On iPhone, iPad, and Android browsers, playback is routed through an HTML media element plus the Media Session API so sound can keep going when you switch apps or lock the screen (see notes below).

## Quick Start

```bash
# Install dependencies
pnpm install

# Start local development server
pnpm dev
```

Open the local server URL provided by Vite (typically `http://localhost:5173`). Click **Play** to start audio output (required due to browser autoplay policies).

### Phone / tablet tips (iOS & Android)

1. Tap **Play** once (required by autoplay rules).
2. Switch apps or lock the screen — audio should continue and appear in system media controls (Control Center / notification shade / lock screen).
3. If the OS later suspends the tab under memory pressure, return to the tab and it will try to resume automatically while Play is still active.
4. **Android:** If sound stops soon after leaving Chrome, check **Settings → Apps → Chrome (or your browser) → Battery** and allow unrestricted / no restriction while playing. Some OEMs (Xiaomi, Huawei, Oppo, etc.) also have “app launch” or “battery saver” rules that kill background tabs.
5. Low Power Mode / battery savers can still stop web audio; ordinary websites cannot claim a full native background-audio entitlement.

### Available Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server with HMR |
| `pnpm build` | Build production assets |
| `pnpm preview` | Preview production build locally |
| `pnpm test` | Run DSP and utility unit tests |
| `pnpm check` | Run `svelte-check` and TypeScript type checking |
| `pnpm validate-manifests` | Validate sound catalog integrity |

### Shortcuts & Controls

- **Spacebar:** Toggle playback Play/Pause (when focus is not on an input or selector element).

### Sleep Timer

1. Select a countdown duration (5–90 minutes or custom value) and fade-out duration.
2. Click **Start timer** (automatically starts audio playback if paused).
3. The timer counts down; during the final fade window, master volume smoothly decreases to zero before stopping playback.
4. Click **Cancel timer** at any time to abort the countdown and restore full volume.

### Stochastic One-Shot Events

- **Natural Randomization:** Triggers random sample accents based on an exponential Poisson timing distribution to prevent predictable patterns.
- **Dynamic Acoustic Variation:** Applies dynamic pitch/rate jitter, randomized stereo positioning (`StereoPannerNode`), and distance-based low-pass filtering.
- **Configurable Density:** Adjust event frequency presets (Sparse, Natural, Dynamic) or test triggers instantly with **Trigger Now**.

### Presets & State

- **Save Presets:** Save the full **scene** — layers, gains, timer defaults, binaural/isochronic tones, and one-shot settings — to `localStorage`.
- **Load Presets:** Click any saved preset to apply its configuration immediately.
- **Session Persistence:** Automatically saves your active state on reload.
- **Share link:** Use **Copy link** to put a URL with `#mix=…` on the clipboard; opening the link restores the scene (no account/backend).
- **Import / Export:** Use **Copy JSON** and **Paste JSON** to back up or share custom mix presets as JSON.
- **Attributions:** Footer → **Attributions** lists every Freesound credit from the catalog (also `#attributions`).

### Ambient Sound Library

- Add procedural noise or curated field recordings from the **Library** panel.
- Audio field recording previews are trimmed and loudness-normalized to Ogg format (`pnpm sounds:freesound`).
- Sound catalog manifest: `public/sounds/catalog.json`.

---

## Architecture

- **UI Framework:** Svelte 5 + TypeScript + Vite
- **Audio Engine:** Web Audio API graph + custom `AudioWorklet` (`src/audio/worklets/noise-processor.js`) + `OneShotEngine`
- **Gain & Volume:** Linear internal gain with logarithmic dB control curves (`src/audio/dsp/curves.ts`)
- **Session Matrix:** State management owning per-layer volume, mute/solo gates, and routing.

```
src/
├── audio/
│   ├── dsp/              # Pure DSP calculations & unit tests
│   ├── worklets/         # AudioWorklet processor implementation
│   ├── engine.ts         # Web AudioContext node graph & lifecycle
│   ├── one-shot-engine.ts# Stochastic event scheduler & spatial audio graph
│   └── types.ts          # Audio engine TypeScript definitions
├── app/
│   ├── session.ts        # Application state, presets & layer matrix
│   └── one-shot.ts       # One-shot density & trigger configurations
└── ui/
    ├── Mixer.svelte      # Main mixer user interface component
    └── OneShotPanel.svelte# Stochastic accent sound settings & trigger panel
```

For full product specs and design decisions, see [Design Document](docs/design-ambient-sound-app.md).

---

## License & Credits

### Software License

This project is open-source software licensed under the **[MIT License](LICENSE)**.

```text
MIT License

Copyright (c) 2026

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Freesound License & Credits

The ambient field recording audio samples included in this repository are sourced from **[Freesound.org](https://freesound.org)** under the **[Creative Commons CC0 1.0 Universal (CC0 1.0) Public Domain Dedication](https://creativecommons.org/publicdomain/zero/1.0/)**.

- **License:** CC0 1.0 Universal (Public Domain).
- **Attribution & Provenance:** Although attribution is not legally required under CC0 1.0, full credits, author names, original track titles, and direct Freesound page links for all included samples are documented in **[ATTRIBUTIONS.md](ATTRIBUTIONS.md)**.

