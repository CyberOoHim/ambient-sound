# Ambient Sound

Offline-first noise and ambient sound mixer (Windows-first).

**Status:** noise + **ambient sample layers**, library, sleep timer, presets.  
Core pack = 5 **Freesound CC0** field recordings (see `ATTRIBUTIONS.md`).

## Quick start

```bash
pnpm install
pnpm dev
```

Open the URL Vite prints (usually `http://localhost:5173`). Click **Play** (browser autoplay policy requires a gesture).

### Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Dev server + HMR |
| `pnpm build` | Production build |
| `pnpm preview` | Preview production build |
| `pnpm test` | Unit tests (DSP + curves) |
| `pnpm check` | `svelte-check` + `tsc` |

### Keyboard

- **Space bar** — same as clicking Play / Pause (when focus is not in an input/select). Hint only — not a UI button.

### Sleep timer

1. Pick a duration (5–90 min or custom minutes) and fade length.
2. Click **Start timer** (starts playback if needed).
3. Countdown runs on wall clock; in the last fade window volume ramps to silence, then audio stops.
4. **Cancel timer** aborts and restores master volume.

### Presets

- **Save** current layers + master + timer defaults to `localStorage`.
- Click a preset name to load it (does not auto-play unless you were already playing).
- **Last session** restores automatically on reload (still requires Play for audio).
- **Copy JSON** / **Paste JSON** for backup or sharing.

### Ambient library

- **Library** panel: add any noise type or a **core pack** ambient loop (rain, ocean, wind, fire, stream).
- Core pack is **Freesound CC0** HQ previews, trimmed + loudnorm’d to Ogg (`pnpm sounds:freesound`).
- Catalog: `public/sounds/catalog.json` · attributions: `ATTRIBUTIONS.md`
- Validate: `pnpm validate-manifests`
- Optional procedural placeholders: `pnpm sounds:generate`

## Architecture (prototype)

- **UI:** Svelte 5 + TypeScript + Vite
- **Audio:** Web Audio API + `AudioWorklet` (`src/audio/worklets/noise-processor.js`)
- **Volume:** store linear gain; UI in dB (−60…0) via `src/audio/dsp/curves.ts`
- **Session:** owns mute/solo matrix; engine applies per-layer mute gates

```
src/
  audio/
    dsp/          # pure DSP + tests
    worklets/     # self-contained worklet (no imports)
    engine.ts     # AudioContext graph
    types.ts
  app/session.ts  # play state + layers
  ui/Mixer.svelte
```

## Design

Full product plan (samples, Tauri, licensing, PR plan): [`docs/design-ambient-sound-app.md`](docs/design-ambient-sound-app.md)

## License

MIT — see `LICENSE`.
