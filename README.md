# Ambient Sound

An offline-first noise, ambient sound, brainwave entrainment, and YouTube audio mixer built for web and mobile.

**Live Demo:** [https://cyberoohim.github.io/ambient-sound/](https://cyberoohim.github.io/ambient-sound/)


## Features

- **Procedural Noise Generators:** Custom Web Audio API DSP noise synth supporting 8 color/tone variations (White, Pink, Brown, Blue, Violet, Rain, Fan, Static) with mono/stereo width control.
- **Curated Ambient Sample Library:** 69 high-quality natural field recording loops across 16 categories (Rain, Thunder, Ocean, Water, Stream, Waterfall, Cave, Wind, Forest, Birds, Insects, Frogs, Fire, Indoor, Urban, Transport).
- **YouTube Audio Integration:** Embed and sync YouTube streams or video tracks (e.g. Lofi Girl, rain streams) as audio mixer layers with oEmbed metadata fetching, saved favorites, and iframe sync.
- **Binaural Beats & Isochronic Tones:** Brainwave entrainment engine offering Binaural (stereo phase offset) and Isochronic (pulsed tone) sound modes across Delta (1–4 Hz), Theta (4–8 Hz), Alpha (8–13 Hz), Beta (13–30 Hz), Gamma (30–50 Hz), and Custom frequency ranges with configurable carrier frequency and sine/triangle waveforms.
- **Stochastic One-Shot Events:** Natural, non-repetitive background audio accents (bird chirps, owl hoots, thunder rolls, cave drips, fire pops, cup clinks, leaf snaps, page turns, etc.) using Poisson-process timing, dynamic pitch jitter, stereo panning, and distance low-pass filtering.
- **Spatial Canvas & Auto-Pan:** Drag layers on an interactive 2D soundstage map (pan × volume) with optional LFO auto-panner per layer.
- **Master DSP & Per-Layer Controls:** Master volume slider (linear/dB), Master Bass & Treble tone controls, Master Reverb, real-time peak level meter, per-layer High-Pass (HPF) and Low-Pass (LPF) filters, mute/solo gates, and layer duplication with randomized loop phase offset.
- **Mood Themes & Spectrum Visualizer:** Palette shifts with active layer acoustics; soft audio spectrum and particle canvas (respects `prefers-reduced-motion`).
- **Local Audio Import:** Drop custom MP3, WAV, OGG, FLAC, or WEBM audio files — stored locally in IndexedDB.
- **Sleep Timer & Pomodoro Cycles:** Flexible duration with customizable linear/logarithmic fade-out curves, plus Pomodoro focus/break interval timer.
- **Custom Presets & URL Hash Sharing:** Save full scenes (layers, gains, binaural tones, one-shots, YouTube streams, master tone) to `localStorage` or export/import JSON presets; share mixes via URL hash (`#mix=…`).
- **Offline-First & Mobile Background Playback:** On mobile browsers (iOS & Android), playback routes through an HTML media element plus the Web Media Session API so audio continues when switching apps or locking the screen.

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
| `pnpm dev` | Start Vite development server with HMR |
| `pnpm build` | Build production assets |
| `pnpm preview` | Preview production build locally |
| `pnpm test` | Run unit tests with Vitest |
| `pnpm test:watch` | Run Vitest in interactive watch mode |
| `pnpm check` | Run `svelte-check` and TypeScript type checking |
| `pnpm validate-manifests` | Validate sound catalog & one-shot event manifests |
| `pnpm sounds:generate` | Generate core synthetic sound pack audio assets |
| `pnpm sounds:freesound` | Fetch and process Freesound CC0 catalog samples |
| `pnpm sounds:events` | Extract and process one-shot accent audio samples |

### Shortcuts & Controls

- **Spacebar:** Toggle playback Play/Pause (when focus is not on an input or selector element).

### Sleep Timer

1. Select a countdown duration (5–90 minutes or custom value) and fade-out duration.
2. Click **Start timer** (automatically starts audio playback if paused).
3. The timer counts down; during the final fade window, master volume smoothly decreases to zero before stopping playback.
4. Click **Cancel timer** at any time to abort the countdown and restore full volume.

### YouTube Audio Integration

- **Add YouTube Streams:** Paste any YouTube video or live stream URL to stream audio as a mixer layer.
- **Saved Stream Favorites:** Save favorite streams locally with oEmbed title & thumbnail previews.
- **Transport Sync:** Synced play/pause, volume control, mute, and solo support alongside Web Audio layers.

### Binaural Beats & Brainwave Entrainment

- **Tone Modes:** Toggle between Binaural beats (stereo frequency offset per ear) and Isochronic pulses.
- **Brainwave Presets:** Quick select for Delta (1–4 Hz), Theta (4–8 Hz), Alpha (8–13 Hz), Beta (13–30 Hz), Gamma (30–50 Hz), or Custom frequencies.
- **Waveforms:** Switch between smooth Sine and rich Triangle wave generators.

### Stochastic One-Shot Events

- **Natural Randomization:** Triggers random sample accents based on an exponential Poisson timing distribution to prevent predictable patterns.
- **Dynamic Acoustic Variation:** Applies dynamic pitch/rate jitter, randomized stereo positioning (`StereoPannerNode`), and distance-based low-pass filtering.
- **Configurable Density:** Adjust event frequency presets (Sparse, Natural, Dynamic) or test triggers instantly with **Trigger Now**.

### Presets & State

- **Save Presets:** Save the full **scene** — layers, gains, spatial positions, EQ filters, timer defaults, binaural/isochronic tones, YouTube streams, and one-shot settings — to `localStorage`.
- **Load Presets:** Click any saved preset to apply its configuration immediately.
- **Session Persistence:** Automatically saves your active state on reload.
- **Share link:** Use **Copy link** to put a URL with `#mix=…` on the clipboard; opening the link restores the scene (no account/backend).
- **Import / Export:** Use **Copy JSON** and **Paste JSON** to back up or share custom mix presets as JSON.
- **Attributions:** Footer → **Attributions** lists every Freesound credit from the catalog (also `#attributions`).

### Ambient Sound Library

- Add procedural noise, curated CC0 field recordings (69 sounds across 16 categories), or YouTube streams from the **Library** panel.
- Import custom MP3, WAV, OGG, FLAC, or WEBM loops saved locally in IndexedDB.
- Sound catalog manifest: `public/sounds/catalog.json`.

---

## Architecture

- **UI Framework:** Svelte 5 + TypeScript + Vite
- **Audio Engine:** Web Audio API graph + custom `AudioWorklet` (`src/audio/worklets/noise-processor.js`) + `BinauralEngine` + `OneShotEngine` + `YouTubePlayerManager` + `MediaOutput` bridge
- **Gain & Volume:** Linear internal gain with logarithmic dB control curves (`src/audio/dsp/curves.ts`)
- **Session Matrix:** State management owning per-layer volume, mute/solo gates, spatial coordinates, EQ filters, and routing.

```
src/
├── audio/
│   ├── dsp/                   # Pure DSP calculations (noise algorithms, dB curves, loop offset)
│   ├── worklets/              # AudioWorklet processor implementation (noise-processor.js)
│   ├── binaural-engine.ts     # Binaural & Isochronic beat tone generator engine
│   ├── decode-cache.ts        # Audio buffer decode & progressive progress cache manager
│   ├── engine.ts              # Web AudioContext node graph & master transport routing
│   ├── local-audio-store.ts   # IndexedDB storage for user-imported audio files
│   ├── media-output.ts        # Media element background audio routing bridge
│   ├── media-session.ts       # Web Media Session API integration (OS media controls)
│   ├── one-shot-engine.ts     # Stochastic Poisson event scheduler & spatial audio graph
│   ├── sample-player.ts       # Audio sample buffer loop player & phase manager
│   ├── types.ts               # Audio engine TypeScript definitions & domain interfaces
│   └── youtube-player.ts      # YouTube IFrame API sync player manager
├── app/
│   ├── binaural.ts            # Binaural brainwave presets & state configuration
│   ├── one-shot.ts            # One-shot density presets & trigger definitions
│   ├── playback-owner.ts      # Multi-tab playback ownership & audio context locks
│   ├── presets.ts             # Preset serialization & localStorage manager
│   ├── session.ts             # Application state store & layer matrix
│   ├── share.ts               # URL hash mix encoding, decoding & sharing
│   └── youtube-urls.ts        # YouTube URL parsing, oEmbed title fetching & storage
├── assets/
│   └── catalog.ts             # Ambient sound catalog loader & manifest type definitions
└── ui/
    ├── AttributionsPanel.svelte# Freesound license & attribution credits panel
    ├── BinauralPanel.svelte   # Binaural & Isochronic beat tone controls
    ├── LibraryPanel.svelte    # Built-in sound catalog & custom user import manager
    ├── Mixer.svelte           # Main mixer interface, master transport & layer strips
    ├── OneShotPanel.svelte    # Stochastic accent sound density & trigger panel
    ├── PresetsPanel.svelte    # Preset save/load & JSON import/export modal
    ├── SpatialCanvas.svelte   # 2D interactive spatial positioning grid
    ├── TimerPanel.svelte      # Sleep countdown timer & Pomodoro cycle control
    ├── YouTubePanel.svelte    # YouTube stream search, saved list & manager
    ├── format.ts              # UI time & display formatting helpers
    └── mood-theme.ts          # Acoustic mood palette sync engine
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

