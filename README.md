# Ambient Sound

An offline-first noise, ambient sound, brainwave entrainment, and YouTube audio mixer built for web and mobile.

**Live Demo:** [https://cyberoohim.github.io/ambient-sound/](https://cyberoohim.github.io/ambient-sound/)


## Features

- **Procedural Noise Generators:** Custom Web Audio API DSP noise synth supporting 8 color/tone variations (White, Pink, Brown, Blue, Violet, Rain, Fan, Static) with mono/stereo width control.
- **Curated Ambient Sample Library:** 69 high-quality natural field recording loops across 16 categories (Rain, Thunder, Ocean, Water, Stream, Waterfall, Cave, Wind, Forest, Birds, Insects, Frogs, Fire, Indoor, Urban, Transport).
- **YouTube Audio Integration:** Embed and sync YouTube live streams or video tracks as audio mixer layers with oEmbed metadata fetching, saved favorites, editable stream titles, search filtering, restore defaults, duplicate protection, and mobile streaming safety caps (max 2 active YouTube layers total, max 1 on iOS WebKit devices).
- **Binaural Beats & Isochronic Tones:** Brainwave entrainment engine offering Binaural (stereo phase offset per ear) and Isochronic (pulsed tone) sound modes across Delta (1–4 Hz), Theta (4–8 Hz), Alpha (8–13 Hz), Beta (13–30 Hz), Gamma (30–50 Hz), and Custom frequency ranges with configurable carrier frequency and sine/triangle waveforms.
- **Stochastic One-Shot Events & Natural Physics:** Natural, non-repetitive background audio accents (bird chirps, owl hoots, thunder rolls, cave drips, fire pops, cup clinks, leaf snaps, page turns, etc.) using Poisson-process timing and 7 Natural Realism Physics & DSP options (dynamic pitch jitter, stereo panning, distance low-pass filtering, Haas reflection micro-delays, transient ducking, and mobile performance safeguards).
- **Spatial Canvas & Distance Air-Absorption DSP:** Drag layers on an interactive 2D soundstage grid (pan × distance/volume) with distance air-absorption high-frequency roll-off filtering and optional per-layer LFO auto-panners (rate & depth controls).
- **Master DSP & Per-Layer Controls:** Master volume slider (linear/dB curves), Master Bass & Treble tone shelving filters, Master Synthetic Convolver Reverb, real-time peak level meter, per-layer High-Pass (HPF) and Low-Pass (LPF) filters, mute/solo gates, layer duplication (up to 3 per sound asset with randomized loop phase offset), and one-click Mix & YouTube panel default reset buttons.
- **Mood Themes & Spectrum Visualizer:** Dynamic palette shifts based on active acoustic layers; real-time audio spectrum, particle canvas, and waveform visualizer (respects `prefers-reduced-motion`).
- **Local Audio Import & Storage:** Drop or browse custom audio files stored locally in IndexedDB with JSON backup import/export, unused layer cleanup, storage quota feedback, and strict file manager extension filtering.
- **PWA & Offline Installation:** Full Progressive Web App support with service worker offline caching, in-app install prompt triggers (`beforeinstallprompt`), and dedicated iOS Safari "Add to Home Screen" visual instructions.
- **Sleep Timer & Pomodoro Focus Cycles:** Flexible countdown timer (5–90 minutes or custom) with customizable linear/logarithmic fade-out curves, plus a Pomodoro interval timer for focus/break cycles.
- **Custom Presets & URL Hash Sharing:** Save full scenes (layers, gains, spatial positions, EQ filters, timer defaults, binaural tones, YouTube streams, one-shots) to `localStorage` or export/import JSON presets; share mixes via compact `#mix=…` URL hash with ~0.4s scene crossfading.
- **Offline-First & Mobile Background Audio:** Web Media Session API integration (lock screen controls, artwork, preset cycling) and HTML media element routing for mobile background playback on iOS & Android. Multi-tab playback ownership locking prevents audio collision across browser tabs.

---

## Supported Upload Audio Formats

User-imported audio tracks are processed in client-side memory via the Web Audio API (`decodeAudioData`) and persisted in local IndexedDB (`ambient-sound-local-audio`). The file chooser strictly filters the following supported formats:

| Format / Codec | Supported Extensions | Recognized MIME Types | Details |
| :--- | :--- | :--- | :--- |
| **MP3** | `.mp3` | `audio/mpeg`, `audio/mp3` | MPEG-1 Audio Layer III, universally supported |
| **WAV** | `.wav` | `audio/wav`, `audio/wave`, `audio/x-wav` | Uncompressed PCM / IEEE Float audio |
| **Ogg Vorbis** | `.ogg`, `.oga` | `audio/ogg`, `audio/oga` | Ogg container with Vorbis compression |
| **Opus** | `.opus` | `audio/opus`, `audio/ogg` | High-efficiency Opus audio codec |
| **FLAC** | `.flac` | `audio/flac`, `audio/x-flac` | Free Lossless Audio Codec |
| **AAC / M4A** | `.aac`, `.m4a` | `audio/aac`, `audio/mp4` | Advanced Audio Coding in raw or MP4 container |
| **WebM Audio** | `.webm`, `.weba` | `audio/webm` | WebM container (Opus / Vorbis audio streams) |
| **AIFF** | `.aif`, `.aiff` | `audio/aiff`, `audio/x-aiff` | Audio Interchange File Format |

### Upload Constraints & Local Storage
- **File Size Limit:** Up to **25 MB** per audio file to prevent memory exhaustion on mobile devices.
- **Privacy & Offline Storage:** Files never leave your browser; audio is stored locally in client-side **IndexedDB** (`ambient-sound-local-audio`).
- **File Manager Filtering:** The file picker input strictly specifies all supported extensions so unsupported files are automatically greyed out/disabled.
- **Backup & Portability:** Export your entire local clip library to a single `.json` backup file or restore it anytime in the Library panel.

---

## Quick Start

```bash
# Install dependencies
pnpm install

# Start local development server
pnpm dev
```

Open the local server URL provided by Vite (typically `http://localhost:5173`). Click **Play** to start audio output (required due to browser autoplay policies).

### Phone / Tablet Tips (iOS & Android)

1. Tap **Play** once (required by browser autoplay rules).
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

---

### Shortcuts & Controls

- **Spacebar:** Toggle playback Play/Pause (when focus is not on an input or selector element).

### Sleep Timer & Pomodoro

1. **Sleep Countdown:** Select a countdown duration (5–90 minutes or custom value) and fade-out curve. Click **Start timer** (starts audio playback if paused). During the final fade window, master volume smoothly decreases to zero before stopping playback.
2. **Pomodoro Cycles:** Configure work/break interval timers with notification support for focus sessions.
3. **Cancel:** Click **Cancel timer** at any time to abort the countdown and restore full volume.

### YouTube Audio Integration

- **Add Streams:** Paste any YouTube video or live stream URL to add it as a mixer layer.
- **Saved Stream Favorites:** Save favorite streams locally with automatic oEmbed title & thumbnail previews, editable custom display titles, and instant search filtering.
- **Restore Defaults:** Restore the default curated stream list at any time or keep a customized empty list state without losing settings.
- **Streaming Caps & Duplicate Protection:** Enforces stream safety caps (max 2 active YouTube layers total, max 1 on iOS WebKit devices due to autoplay limits) and prevents duplicate YouTube streams in the active mix. YouTube layers cannot be duplicated.
- **Transport Sync:** Synced play/pause, volume control, mute, and solo support alongside Web Audio API layers.

### Spatial Canvas & Distance Air-Absorption DSP

- **2D Soundstage Grid:** Drag layer nodes on an interactive spatial canvas where X controls stereo panning (-1.0 to +1.0) and Y controls distance/gain.
- **Air-Absorption Filtering:** Simulates real-world acoustic air absorption by applying continuous high-frequency low-pass filtering as distance increases.
- **Auto-Pan LFO:** Enable optional low-frequency oscillator auto-panning per layer with configurable rate and depth controls.

### Master DSP & Per-Layer Controls

- **Tone & Reverb:** Master Bass & Treble shelving EQ controls plus synthetic convolver reverb wetness in Mix settings.
- **Per-Layer Filters:** Individual High-Pass (HPF) and Low-Pass (LPF) filters per sound layer, persisted in presets and share URLs.
- **Layer Duplication:** Duplicate active audio layers (up to 3 duplicates per catalog sound) with randomized loop phase offsets.
- **Reset Controls:** One-click "Reset to Default" buttons in Mix settings and the YouTube panel to restore initial states easily.

### Binaural Beats & Brainwave Entrainment

- **Tone Modes:** Toggle between Binaural beats (stereo frequency offset per ear) and Isochronic pulses.
- **Brainwave Presets:** Quick select for Delta (1–4 Hz), Theta (4–8 Hz), Alpha (8–13 Hz), Beta (13–30 Hz), Gamma (30–50 Hz), or Custom frequencies.
- **Waveforms:** Switch between smooth Sine and harmonic Triangle wave generators.

### Stochastic One-Shot Events & Natural Physics

- **Poisson Process Timing:** Triggers random sound accents using an exponential Poisson distribution for organic, non-periodic timing.
- **7 Natural Realism Physics & DSP Options:** Includes dynamic pitch/rate jitter, randomized stereo positioning (`StereoPannerNode`), distance low-pass filtering, Haas reflection micro-delays, transient ducking, spatial panning, and mobile performance safeguards.
- **Density & Manual Triggers:** Choose frequency density presets (Sparse, Natural, Dynamic) or fire events instantly using **Trigger Now**.

### Presets, Sharing & Crossfading

- **Save Presets:** Save full scene configurations — active layers, gains, spatial coordinates, EQ filters, timer settings, binaural tones, YouTube streams, and one-shots — to `localStorage`.
- **URL Hash Sharing:** Use **Copy link** to share mixes via URL hash (`#mix=…`) with no server required.
- **Preset Crossfading:** Seamless ~0.4s crossfade when loading presets or applying shared links while playback is active.
- **Import / Export Backup:** Back up custom presets via JSON copy/paste.

### Local Audio Import & Storage

- **Custom Loops:** Drop MP3, WAV, OGG, FLAC, AAC, M4A, Opus, WebM, or AIFF audio files to store them locally in IndexedDB and mix them offline.
- **Storage Management:** Export/import local audio library backups, monitor browser storage usage estimates, and remove unused files.

---

## Architecture

- **UI Framework:** Svelte 5 + TypeScript + Vite
- **Audio Engine:** Web Audio API graph + custom `AudioWorklet` (`src/audio/worklets/noise-processor.js`) + `BinauralEngine` + `OneShotEngine` + `YouTubePlayerManager` + `MediaOutput` bridge
- **Gain & Volume:** Linear internal gain with logarithmic dB control curves (`src/audio/dsp/curves.ts`)
- **Session Matrix:** State management owning per-layer volume, mute/solo gates, spatial coordinates, EQ filters, and routing.

```
src/
├── audio/
│   ├── dsp/                   # Pure DSP calculations (noise synth, dB curves, loop offset)
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
│   ├── pwa.ts                 # PWA install prompt handler & platform detection
│   ├── session.ts             # Application state store & layer matrix
│   ├── share.ts               # URL hash mix encoding, decoding & sharing
│   └── youtube-urls.ts        # YouTube URL parsing, oEmbed title fetching & storage
├── assets/
│   └── catalog.ts             # Ambient sound catalog loader & manifest type definitions
└── ui/
    ├── AttributionsPanel.svelte# Freesound license & attribution credits panel
    ├── BinauralPanel.svelte   # Binaural & Isochronic beat tone controls
    ├── InstallModal.svelte    # PWA install modal & iOS Safari guidance dialog
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


